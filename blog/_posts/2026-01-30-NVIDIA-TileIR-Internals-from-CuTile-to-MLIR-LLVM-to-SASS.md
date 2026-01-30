---
layout:     post
title:      "NVIDIA TileIR Internals: from CuTile to MLIR/LLVM to SASS"
date:       2026-01-30 06:00:00
summary:    Deep dive into NVIDIA's TileIR compiler - cuda_tile, nv_tileaa, nv_tileas, NVVM, and LLVM to SASS
categories: TileIR
thumbnail:  "/assets/images/posts/2026-01-29/pipeline_overview.png"
comments:   true
tags:
 - TileIR
jupyter:    false
mermaid:
    enabled: true
    zoomable: true
---

In this post, we'll dig deep into how TileIR works, from how it generates instructions to analyzing its different passes. We'll trace how a Mixture-of-Experts (MoE) kernel written in CuTile gets compiled down through `cuda_tile` → `nv_tileaa` → `nv_tileas` → NVVM → LLVM → SASS.

Here's what to expect:

- [**What is CuTile?**](#what-is-cutile) — The tile-centric programming model
- [**Running Example**](#running-example-moe-kernel) — An MoE kernel we'll trace through every stage
- [**The Dialects**](#the-dialects) — From `cuda_tile` through `nv_tileaa` and `nv_tileas` to NVVM/LLVM
- [**The Passes**](#the-passes) — TileIR passes: what they do and when they run

*Based on CUDA 13.1. Some details are undocumented and may change in future releases.*

# What is CuTile?

{% include image.html path="/assets/images/posts/2026-01-29/cutile.png" text="CuTile separates user responsibility (splitting work into blocks and tiles) from system responsibility (mapping to threads)" url_source="https://youtu.be/_b4I4rKpsGA?t=406" url_text="GPU MODE" %}

[CuTile](https://github.com/NVIDIA/cutile-python) is NVIDIA's new "tile-centric" programming model for modern NVIDIA GPUs. This abstraction is powerful: CuTile lets the programmer think in terms of tiles rather than threads, while the compiler handles the complexity of coordinating hundreds of threads across fragmented data. A single CuTile line `ct.mma(a, b, acc)` could get transformed to many tensor core instructions.

## What is TileIR?

TileIR is NVIDIA's MLIR-based compiler infrastructure that powers CuTile. It progressively lowers your high-level tensor operations through multiple MLIR dialects and NVIDIA specific tools:

{% include image.html path="/assets/images/posts/2026-01-29/pipeline_overview.svg" width="100%" text="TileIR compilation pipeline: Python → SASS" %}

The user-facing tool is `tileiras`<span class="sidenote-ref"></span><span class="sidenote">Like `ptxas` but for TileIR. Yes, NVIDIA named it "tile-ir-as" (tile IR assembler).</span>, which orchestrates this entire pipeline.

---

# Running Example: MoE Kernel

Throughout this post, we'll trace this **MoE (Mixture of Experts) kernel** through every compilation stage. This is code from [NVIDIA's cutile-python samples](https://github.com/NVIDIA/cutile-python/blob/main/samples/MoE.py)<span class="sidenote-ref"></span><span class="sidenote">There's also a C++ API: [NVIDIA/cuda-tile](https://github.com/NVIDIA/cuda-tile). Operations like `ct.gather`, `ct.mma`, `cuda_tile.load_view_tko` documented in [TileIR docs](https://docs.nvidia.com/cuda/tile-ir/13.1/sections/operations.html).</span>:

```python
@ct.kernel
def fused_moe_kernel(
    A,                          # Input tokens, shape (batch, K)
    B,                          # Expert weights, shape (num_experts, N, K)
    C,                          # Output tensor, shape (num_tokens * topk, N)
    topk_weights,               # Router weights for each token-expert pair
    sorted_token_ids,           # Token indices sorted by expert assignment
    sorted_expert_ids,          # Expert index for each TILE_M
    num_token_replicas: int,
    mul_routed_weight: ConstBool,
    TILE_M: ConstInt,
    TILE_N: ConstInt,
    TILE_K: ConstInt,
):
    M = sorted_token_ids.shape[0]
    N = B.shape[1]
    K = B.shape[2]

    GROUP_SIZE_M = 8
    bid_m, bid_n = swizzle_2d(M, N, TILE_M, TILE_N, GROUP_SIZE_M)  # → cuda_tile.get_tile_block_id

    # Gather token indices for this block
    token_id_indices = bid_m * TILE_M + ct.arange(TILE_M, dtype=ct.int32)
    token_ids = ct.gather(sorted_token_ids, token_id_indices)      # → cuda_tile.load_view_tko
    a_row_indices = token_ids // num_token_replicas
    expert_id = ct.load(sorted_expert_ids, index=bid_m, shape=())  # → cuda_tile.load_ptr_tko

    # Initialize accumulator
    accumulator = ct.full((TILE_M, TILE_N), 0.0, dtype=ct.float32) # → cuda_tile.constant

    for k in range(0, ct.cdiv(K, TILE_K)):                         # → cuda_tile.for
        # Load A tile (gathered by token indices)
        a_col_indices = k * TILE_K + ct.arange(TILE_K, dtype=ct.int32)
        a = ct.gather(A, (a_row_indices[:, None], a_col_indices[None, :]))  # → cuda_tile.load_view_tko

        # Load B tile (expert weights)
        b = ct.load(B, (expert_id, k, bid_n), shape=(1, TILE_K, TILE_N),
                    order=(0, 2, 1)).reshape((TILE_K, TILE_N))      # → cuda_tile.load_ptr_tko

        accumulator = ct.mma(a, b, accumulator)                     # → cuda_tile.mmaf ← THE COMPUTE!

    if mul_routed_weight:
        moe_weight = ct.gather(topk_weights, token_ids)
        accumulator = accumulator * moe_weight[:, None]             # → cuda_tile.mulf

    # Scatter results back to output
    c_col_indices = bid_n * TILE_N + ct.arange(TILE_N, dtype=ct.int32)
    accumulator = ct.astype(accumulator, C.dtype)                   # → cuda_tile.ftof
    ct.scatter(C, (token_ids[:, None], c_col_indices[None, :]), accumulator)  # → cuda_tile.store_ptr_tko
```

**The three key operations we'll trace:**

<table style="width: 100%; border-collapse: collapse; font-family: monospace; font-size: 0.9em;">
<thead>
<tr style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);">
<th style="padding: 12px; text-align: left; color: #76b900; border-bottom: 2px solid #76b900;">Python</th>
<th style="padding: 12px; text-align: left; color: #76b900; border-bottom: 2px solid #76b900;">cuda_tile</th>
<th style="padding: 12px; text-align: left; color: #76b900; border-bottom: 2px solid #76b900;">What it does</th>
</tr>
</thead>
<tbody>
<tr style="background: rgba(118, 185, 0, 0.1);">
<td style="padding: 10px; border-bottom: 1px solid #333;">ct.gather(A, indices)</td>
<td style="padding: 10px; border-bottom: 1px solid #333;">load_view_tko</td>
<td style="padding: 10px; border-bottom: 1px solid #333; font-family: sans-serif;">Gather tokens by expert assignment (indirect load)</td>
</tr>
<tr style="background: rgba(0, 150, 255, 0.1);">
<td style="padding: 10px; border-bottom: 1px solid #333;">ct.load(B, ...)</td>
<td style="padding: 10px; border-bottom: 1px solid #333;">load_ptr_tko</td>
<td style="padding: 10px; border-bottom: 1px solid #333; font-family: sans-serif;">Load expert weights (direct load)</td>
</tr>
<tr style="background: rgba(255, 100, 100, 0.1);">
<td style="padding: 10px;">ct.mma(a, b, acc)</td>
<td style="padding: 10px;">mmaf</td>
<td style="padding: 10px; font-family: sans-serif;">Matrix multiply-accumulate on tensor cores</td>
</tr>
</tbody>
</table>

Watch how these transform through `nv_tileaa`, `nv_tileas` and finally to SASS instructions.

---

# Compiling with tileiras

The `tileiras` command-line tool is the ahead-of-time compiler that transforms `.cutile` bytecode into GPU binaries.

```bash
tileiras --gpu-name sm_120 MoE.cutile -o moe.cubin
```

## Undocumented Environment Variables

These TileIR-specific environment variables affect compilation:

{% include fancy_table.html
    first_load="false"
    px="4"
    py="2"
    id="env-vars-table"
    headers="Variable,Description"
    data="TILEIR_ALWAYS_SWIZZLE,Force swizzle mode for TMA operations
    TILEIR_PREFER_TMA_FOR_LOAD_STORE,Prefer TMA for all load/store operations
    TILEIR_DELAY_TMA_STORE_WAIT,Delay TMA store wait (optimization for overlapping compute)"
%}

<details markdown="1">
<summary><strong>Example: Effect of TILEIR_ALWAYS_SWIZZLE</strong></summary>

```bash
# Without swizzle
$ tileiras --gpu-name sm_120 MoE.cutile -o moe.cubin
$ cuobjdump -sass moe.cubin | grep -i "LD\|ST" | head -3
        /*0910*/                   LDG.E R9, desc[UR8][R2.64] ;
        /*1c30*/                   LDGSTS.E.BYPASS.128 [R45], desc[UR8][R10.64], P0 ;

# With swizzle forced
$ TILEIR_ALWAYS_SWIZZLE=1 tileiras --gpu-name sm_120 MoE.cutile -o moe_swizzle.cubin
$ cuobjdump -sass moe_swizzle.cubin | grep -i "LD\|ST" | head -3
        /*0910*/                   LDG.E.SWIZZLE R9, desc[UR8][R2.64] ;
        /*1c30*/                   LDGSTS.E.BYPASS.SWIZZLE.128 [R45], desc[UR8][R10.64], P0 ;
```

</details>

## Interesting undocumented CLI options

The `--print-before-all` flag dumps LLVM IR before each compilation pass. 

```bash
$ tileiras --print-before-all --gpu-name=sm_120 MoE.cutile -o moe.cubin 2>&1
```

```llvm
*** IR Dump Before Add __emutls_[vt]. variables for emultated TLS model (lower-emutls) ***
; ModuleID = 'LLVMDialectModule'
source_filename = "LLVMDialectModule"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"

@__CUDA_TILEIR_FUNC_NAME_0 = internal constant [17 x i8] c"fused_moe_kernel\00"
...
```

<details markdown="1">
<summary><strong>All LLVM passes dumped (27 unique passes)</strong></summary>

```
*** IR Dump Before Add __emutls_[vt]. variables for emultated TLS model (lower-emutls) ***
*** IR Dump Before Canonicalize natural loops (loop-simplify) ***
*** IR Dump Before CodeGen Prepare (codegenprepare) ***
*** IR Dump Before Constant Hoisting (consthoist) ***
*** IR Dump Before Exception handling preparation (dwarf-eh-prepare) ***
*** IR Dump Before Expand Atomic instructions (atomic-expand) ***
*** IR Dump Before Expand fp (expand-fp) ***
*** IR Dump Before Expand indirectbr instructions (indirectbr-expand) ***
*** IR Dump Before Expand large div/rem (expand-large-div-rem) ***
*** IR Dump Before Expand memcmp() to load/stores (expand-memcmp) ***
*** IR Dump Before Expand reduction intrinsics (expand-reductions) ***
*** IR Dump Before Instrument function entry/exit with calls to e.g. mcount() (post-inline-ee-instrument) ***
*** IR Dump Before Interleaved Access Pass (interleaved-access) ***
*** IR Dump Before Lower AMX intrinsics (lower-amx-intrinsics) ***
*** IR Dump Before Lower AMX type for load/store (lower-amx-type) ***
*** IR Dump Before Lower Garbage Collection Instructions (gc-lowering) ***
*** IR Dump Before Merge contiguous icmps into a memcmp (mergeicmps) ***
*** IR Dump Before ObjC ARC contraction (objc-arc-contract) ***
*** IR Dump Before Partially inline calls to library functions (partially-inline-libcalls) ***
*** IR Dump Before Pre-ISel Intrinsic Lowering (pre-isel-intrinsic-lowering) ***
*** IR Dump Before Prepare callbr (callbrprepare) ***
*** IR Dump Before Remove unreachable blocks from the CFG (unreachableblockelim) ***
*** IR Dump Before Replace intrinsics with calls to vector library (replace-with-veclib) ***
*** IR Dump Before Safe Stack instrumentation pass (safe-stack) ***
*** IR Dump Before Scalarize Masked Memory Intrinsics (scalarize-masked-mem-intrin) ***
*** IR Dump Before Shadow Stack GC Lowering (shadow-stack-gc-lowering) ***
*** IR Dump Before X86 Partial Reduction (x86-partial-reduction) ***
```

</details>


---

# Pipeline Overview

{% include image.html path="/assets/images/posts/2026-01-29/pipeline_overview.svg" width="100%" text="TileIR compilation pipeline: Python → SASS" %}

<!-- Excalidraw diagram: Pipeline Flow - Python → cuda_tile → nv_tileaa → nv_tileas → NVVM → LLVM → PTX → SASS -->

TileIR takes your CuTile Python code through a series of progressive lowerings:

{% include fancy_table.html
    first_load="false"
    px="4"
    py="2"
    id="pipeline-stages-table"
    headers="Stage,Format,Description"
    data="Python,CuTile API,High-level tensor operations (make_tensor_view; mmaf)
    .cutile,Bytecode,Serialized representation of the kernel
    cuda_tile,MLIR Dialect,High-level tensor ops; architecture-independent
    nv_tileaa,MLIR Dialect,Tile-level ops; explicit memory references
    nv_tileas,MLIR Dialect,Scheduled ops; async pipelines
    LLVM/NVVM,LLVM IR,Standard LLVM with NVIDIA intrinsics
    PTX,Assembly,Virtual GPU assembly
    SASS,Machine Code,Native GPU instructions (sm_120)"
%}

Each stage removes abstraction and adds architecture-specific detail. By the time we reach SASS, every memory access pattern, tensor core instruction, and synchronization barrier is explicit.

---

# The Dialects

TileIR uses three main MLIR dialects to represent computations at different abstraction levels. Let's trace our MoE kernel through each one:

<!-- Excalidraw diagram: MoE Operation Mapping - shows gather/load/mma traced through each dialect -->

{% include fancy_table.html
    first_load="false"
    px="4"
    py="2"
    id="moe-ops-table"
    headers="Python,cuda_tile,nv_tileaa,nv_tileas,SASS"
    data="ct.gather(A&#44; idx),load_view_tko,tileaa.load_view,tileas.utcpglobalmem,UTCPMULTI / LDG
    ct.load(B&#44; ...),load_ptr_tko,tileaa.load_tko,tileas.tcgen05_ld,TCGEN05.LD.S
    ct.mma(a&#44; b&#44; c),mmaf,tileaa.mmaf_tko,tileas.tcgen05_mma,TCGEN05.MMA"
%}

## cuda_tile: High-Level Tensor Operations

{% include image.html path="/assets/images/posts/2026-01-29/cuda_tile_dialect.svg" width="100%" text="cuda_tile dialect operations" %}

The `cuda_tile` dialect is closest to your Python code. Operations work on abstract tensor views without worrying about memory layout or hardware details.

**Key operations:**
- `make_tensor_view` - Create a view into a tensor with shape and strides
- `get_tile_block_id` - Get the current thread block's position in the grid
- `load_view_tko` / `store_view_tko` - Load/store tiles with token-based ordering
- `mmaf` - Matrix multiply-accumulate (targets tensor cores)
- `for` / `continue` - Loop constructs for K-dimension iteration

### MoE in cuda_tile

Recall our [MoE kernel above](#running-example-moe-kernel). Here's how the key operations map to `cuda_tile` IR:

**Python → cuda_tile mapping:**

{% include fancy_table.html
    first_load="false"
    px="4"
    py="2"
    id="python-ir-mapping-table"
    headers="Python (CuTile),cuda_tile IR,Purpose"
    data="ct.gather(),load_view_tko,Gather elements by indices
    ct.load(),load_ptr_tko,Load contiguous tile from memory
    ct.mma(),mmaf,Matrix multiply-accumulate (tensor cores)
    ct.scatter(),store_ptr_tko,Scatter elements to output
    ct.full(),constant,Initialize accumulator
    for k in range(),for/continue,K-dimension iteration loop
    ct.astype(),ftof,Type conversion (F32 → output dtype)"
%}

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">Expand to see cuda_tile IR from MoE kernel key sections</summary>

```llvm
// cuda_tile dialect - MoE kernel

%1 = "cuda_tile.constant"() : () -> (ct.view)     // TILE_M
%2 = "cuda_tile.constant"() : () -> (ct.view)     // TILE_N
%3 = "cuda_tile.constant"() : () -> (ct.view)     // TILE_K
%4 = "cuda_tile.assume"(%arg0) : (ct.view) -> (ct.view)
%5 = "cuda_tile.assume"(%arg1) : (ct.view) -> (ct.view)

%10 = "cuda_tile.make_tensor_view"(%4, %5, %6, %7, %8, %9)
    : (ct.view, ct.view, ct.view, ct.view, ct.view, ct.view) -> (ct.token)
%11 = "cuda_tile.make_tensor_view"(%arg2, %arg3) : (ct.view, ct.view) -> (ct.token)
%12 = "cuda_tile.make_token"() : () -> (ct.ptr)

%20, %21, %22 = "cuda_tile.get_tile_block_id"() : () -> (ct.view, ct.view, ct.view)
%23 = "cuda_tile.divi"(%4, %1) : (ct.view, ct.view) -> (ct.view)   // M / TILE_M
%24 = "cuda_tile.muli"(%1, %23) : (ct.view, ct.view) -> (ct.view)
%25 = "cuda_tile.divi"(%20, %24) : (ct.view, ct.view) -> (ct.view)

%30 = "cuda_tile.remi"(%20, %25) : (ct.view, ct.view) -> (ct.view)   // expert routing
%31 = "cuda_tile.cmpi"(%30, %1) : (ct.view, ct.view) -> (ct.view)
%32 = "cuda_tile.select"(%31, %30, %25) : (ct.view, ct.view, ct.view) -> (ct.view)

%40 = "cuda_tile.iota"() : () -> (ct.view)
%41 = "cuda_tile.reshape"(%24) : (ct.view) -> (ct.view)
%42 = "cuda_tile.broadcast"(%41) : (ct.view) -> (ct.view)
%43 = "cuda_tile.addi"(%42, %40) : (ct.view, ct.view) -> (ct.view)
%44 = "cuda_tile.offset"(%42, %43) : (ct.view, ct.view) -> (ct.view)

%50, %51 = "cuda_tile.load_ptr_tko"(%44, %31, %42, %12)             // ct.load()
    : (ct.view, ct.view, ct.view, ct.ptr) -> (ct.view, ct.ptr)
%52 = "cuda_tile.make_partition_view"(%10) : (ct.token) -> (ct.part)
%53, %54 = "cuda_tile.load_view_tko"(%52, %43, %12)                 // ct.gather()
    : (ct.part, ct.view, ct.ptr) -> (ct.view, ct.ptr)

%60 = "cuda_tile.for"(%1, %23, %3, %arg4) {1 regions}              // K-loop
    : (ct.view, ct.view, ct.view, ct.view) -> (ct.view)
    %61 = "cuda_tile.muli"(%iter, %3) : (ct.view, ct.view) -> (ct.view)
    %62 = "cuda_tile.broadcast"(%61) : (ct.view) -> (ct.view)
    %63, %64 = "cuda_tile.load_ptr_tko"(%62, %31, %42, %12)
        : (ct.view, ct.view, ct.view, ct.ptr) -> (ct.view, ct.ptr)
    %65, %66 = "cuda_tile.load_view_tko"(%52, %62, %12)
        : (ct.part, ct.view, ct.ptr) -> (ct.view, ct.ptr)
    %67 = "cuda_tile.mmaf"(%63, %65, %acc)                          // ct.mma()
        : (ct.view, ct.view, ct.view) -> (ct.view)
    "cuda_tile.continue"(%67) : (ct.view) -> ()

%70 = "cuda_tile.ftof"(%60) : (ct.view) -> (ct.view)               // ct.astype()
%71 = "cuda_tile.store_ptr_tko"(%44, %70, %31, %12)                // ct.scatter()
    : (ct.view, ct.view, ct.view, ct.ptr) -> (ct.ptr)
"cuda_tile.return"()
```

</details>

## nv_tileaa

{% include image.html path="/assets/images/posts/2026-01-29/nv_tileaa_dialect.svg" width="100%" text="nv_tileaa dialect operations" %}

The `nv_tileaa` dialect lowers tensor views to concrete memory references. This is where we start seeing explicit memory operations.

**Key changes from cuda_tile:**
- `make_tensor_view` → `make_memref` (explicit memory references)
- `get_tile_block_id` → `get_program_id` (program-centric naming)
- `mmaf` → `dot` (more explicit accumulation)
- Explicit `tiled_load` / `tiled_store` with memory tokens
- New ops: `splat`, `broadcast`, `addptr` for memory address calculations

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">Expand to see nv_tileaa IR from MoE kernel key sections</summary>

```llvm
// nv_tileaa dialect - MoE kernel
// Tile-level ops (architecture-independent)

"nv_tileaa.func"() {nv_tileaa.kernel_spec} {1 regions}

// Input validation
%1 = "nv_tileaa.assume"(%arg0) : (aa.memref) -> (aa.memref)
%2 = "nv_tileaa.assume"(%arg1) : (iN) -> (iN)
%3 = "nv_tileaa.assume"(%2) : (iN) -> (iN)

// Splat: scalar → tensor (for broadcasting)
%10 = "nv_tileaa.splat"(%3) : (iN) -> (tensor<...>)
%11 = "nv_tileaa.splat"(%2) : (iN) -> (tensor<...>)

// Memory reference creation (lowered from make_tensor_view)
%20 = "nv_tileaa.make_memref"(%1, %2, %3, %4, %5, %6)
    : (aa.memref, iN, iN, iN, iN, iN) -> (aa.btile)
%21 = "nv_tileaa.make_memref"(%1, %2) : (aa.memref, iN) -> (aa.btile)
%22 = "nv_tileaa.create_mem_token"() : () -> (aa.ptr)

// Program indexing
%30 = "nv_tileaa.get_program_id"() : () -> (iN)
%31 = "nv_tileaa.splat"(%30) : (iN) -> (tensor<...>)
%32 = "nv_tileaa.make_range"(%c0, %c128) : (iN, iN) -> (tensor<...>)
%33 = "nv_tileaa.extract"(%32) : (tensor<...>) -> (iN)

// Pointer arithmetic
%40 = "nv_tileaa.splat"(%1) : (aa.memref) -> (tensor<...>)
%41 = "nv_tileaa.addptr"(%40, %33) : (tensor<...>, tensor<...>) -> (tensor<...>)

// Masked loads
%50, %51 = "nv_tileaa.load"(%41, %mask, %c0, %22)
    : (tensor<...>, tensor<...>, tensor<...>, aa.ptr) -> (tensor<...>, aa.ptr)

// Tiled memory operations
%60 = "nv_tileaa.block_tile"(%20) : (aa.btile) -> (aa.mtoken)
%61 = "nv_tileaa.extract"(%32) : (tensor<...>) -> (iN)
%62, %63 = "nv_tileaa.tiled_load"(%60, %61, %22)
    : (aa.mtoken, iN, aa.ptr) -> (tensor<...>, aa.ptr)
%64 = "nv_tileaa.view"(%62) : (tensor<...>) -> (tensor<...>)

// Shape manipulation
%70 = "nv_tileaa.expand_dims"(%33) : (tensor<...>) -> (tensor<...>)
%71 = "nv_tileaa.broadcast"(%70) : (tensor<...>) -> (tensor<...>)

// DOT OPERATION (lowered from cuda_tile.mmaf)
%80 = "nv_tileaa.dot"(%50, %64, %acc)
    : (tensor<...>, tensor<...>, tensor<...>) -> (tensor<...>)

// Output
%90 = "nv_tileaa.fp_to_fp"(%80) : (tensor<...>) -> (tensor<...>)
%91 = "nv_tileaa.store"(%41, %90, %mask, %22)
    : (tensor<...>, tensor<...>, tensor<...>, aa.ptr) -> (aa.ptr)
"nv_tileaa.return"()
```

**Key transformations from cuda_tile → nv_tileaa:**

{% include fancy_table.html
    first_load="false"
    px="4"
    py="2"
    id="dialect-comparison-table"
    headers="cuda_tile,nv_tileaa,Change"
    data="make_tensor_view,make_memref,Abstract view → concrete memory ref
    get_tile_block_id,get_program_id,Tile-centric → program-centric naming
    mmaf,dot,High-level MMA → explicit dot product
    load_view_tko,tiled_load + view,Decomposed into separate ops
    ct.view types,tensor<...>,Abstract → explicit tensor shapes
    ct.token,aa.btile; aa.mtoken,Memory tokens more specific"
%}

**Pass #12 observation:** The 32 `fp_to_fp` operations suggest this MoE kernel produces 32 output tiles that need precision conversion from F32 accumulator to the output dtype.

</details>

## nv_tileas

{% include image.html path="/assets/images/posts/2026-01-29/nv_tileas_tcgen05.svg" width="100%" text="nv_tileas dialect with tcgen05 operations" %}

The `nv_tileas` dialect is where architecture-specific code generation happens.

This dialect introduces:

**Async Pipeline Operations:**
- `async.pipeline.create` - Create a software pipeline for overlapping compute/memory
- `producer_acquire` / `producer_commit` - Acquire/release pipeline stages
- `consumer_wait` / `consumer_release` - Synchronize consumers with producers

**Tensor Memory Operations:**
- `tcgen05.alloc` - Allocate dedicated tensor memory
- `tmem_load` / `tmem_store` - Access tensor memory

**Tensor Core Operations:**
- `tcgen05.mma` - Matrix Multiply-Accumulate
- `block_scaled_mma` - Block-scaled MMA for mixed precision
- `mma.fence` - Memory fence for MMA operations

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">Expand to see nv_tileas IR from MoE kernel key sections</summary>

```llvm
// nv_tileas dialect - MoE kernel
// Tile-level Scheduled Assembly

// Layout conversion and view operations
%1, %2 = "nv_tileas.load"(%ptr, %mask, %c0, %token)
    : (tensor<...>, tensor<...>, tensor<...>, aa.ptr) -> (tensor<...>, aa.ptr)
%3, %4 = "nv_tileas.tiled_load"(%btile, %idx, %token)
    : (aa.mtoken, iN, aa.ptr) -> (tensor<...>, aa.ptr)
%5 = "nv_tileas.view"(%3) : (tensor<...>) -> (tensor<...>)

// Convert layout for tensor cores
%10 = "nv_tileas.convert_layout"(%bcast) : (tensor<...>) -> (tensor<...>)
%11 = "nv_tileas.convert_layout"(%5) : (tensor<...>) -> (tensor<...>)
%12 = "nv_tileas.convert_layout"(%1) : (tensor<...>) -> (tensor<...>)

// DOT with input allowances
%20 = "nv_tileas.dot"(%10, %11, %12, %c1)
    : (tensor<...>, tensor<...>, tensor<...>, iN) -> (tensor<...>)

// TMA descriptor
%25 = "nv_tileas.make_tiled_tma_desc"(%memref) {tmaIdx=0}
    : (aa.btile) -> (!tma.desc)

// ASYNC PIPELINE (producer-consumer model)

// Pipeline and iterator creation
%30 = "nv_tileas.async.pipeline.create_pipeline"() : () -> (!pipeline)
%31 = "nv_tileas.async.pipeline.create_pipeline"() : () -> (!pipeline)
%32 = "nv_tileas.async.pipeline.create_iterator"(%30) : (!pipeline) -> (!iter)
%33 = "nv_tileas.async.pipeline.create_iterator"(%31) : (!pipeline) -> (!iter)

// Agent switch (4 regions for producer/consumer roles)
"nv_tileas.async.pipeline.agent_switch"(%arg0, %30, %32, %31, %33) {4 regions}
    : (aa.memref, !pipeline, !iter, !pipeline, !iter) -> ()

// Tensor allocation (double-buffering)
%40 = "nv_tileas.alloc_tensor"() : () -> (tensor<128x64xbf16>)
%41 = "nv_tileas.alloc_tensor"() : () -> (tensor<64x128xbf16>)

// Slice operations
%50 = "nv_tileas.extract_slice"(%40, %c0) : (tensor<...>, iN) -> (tensor<...>)
%51 = "nv_tileas.insert_slice"(%data, %40, %c0, %c64)
    : (tensor<...>, tensor<...>, iN, iN) -> (tensor<...>)

// PRODUCER: acquire → write → commit
%60 = "nv_tileas.async.pipeline.producer_acquire"(%30, %32) : (!pipeline, !iter) -> (!stage)
%61 = "nv_tileas.async.pipeline.producer_write"(%60, %30) {1 regions}
    : (!stage, !pipeline) -> (!stage)
    %62 = "nv_tileas.async.load"(%51, %ptr, %mask, %c16)
        : (tensor<...>, tensor<...>, tensor<...>, tensor<...>) -> (!async)
    "nv_tileas.async.pipeline.yield"(%62) : (!async) -> ()
"nv_tileas.async.pipeline.producer_commit"(%30, %61) : (!pipeline, !stage) -> ()

// CONSUMER: wait → read → release
%70 = "nv_tileas.async.pipeline.consumer_wait"(%31, %33) : (!pipeline, !iter) -> (!stage)
%71, %72 = "nv_tileas.async.pipeline.consumer_read"(%70, %31) {1 regions}
    : (!stage, !pipeline) -> (!stage, tensor<...>)
    %73 = "nv_tileas.copy"(%buf) : (tensor<...>) -> (tensor<...>)
    "nv_tileas.async.pipeline.yield"(%73) : (tensor<...>) -> ()
"nv_tileas.async.pipeline.consumer_release"(%31, %71) : (!pipeline, !stage) -> ()

// Matrix multiply (100+ ops for tiled GEMM)
%80 = "nv_tileas.dot"(%50, %72, %acc, %c1)
    : (tensor<...>, tensor<...>, tensor<...>, iN) -> (tensor<...>)
%81 = "nv_tileas.dot"(%50, %72, %80, %c1)
    : (tensor<...>, tensor<...>, tensor<...>, iN) -> (tensor<...>)

// TMA load
%90 = "nv_tileas.async.tiled_tma_load"(%btile, %buf, %25, %idx, %c0, %c64)
    : (aa.mtoken, tensor<...>, !tma.desc, iN, iN, iN) -> (!async)

// Output
%100 = "nv_tileas.insert_slice"(%result, %41, %c0, %c0)
    : (tensor<...>, tensor<...>, iN, iN) -> (tensor<...>)
%101 = "nv_tileas.view"(%100) : (tensor<...>) -> (tensor<...>)
%102 = "nv_tileas.convert_layout"(%101) : (tensor<...>) -> (tensor<...>)
```

</details>

## NVVM + LLVM

After `nv_tileas`, the compiler lowers to NVVM (NVIDIA's LLVM dialect) and then to standard LLVM IR.

**Key NVVM intrinsics:**
- `@llvm.nvvm.mma.sync.*` - Tensor core matrix multiply
- `@llvm.nvvm.ldmatrix.*` - Load matrix fragments from shared memory
- `@llvm.nvvm.cp.async.*` - Asynchronous memory copy
- `@llvm.nvvm.bar.warp.sync` - Warp-level synchronization
- `@llvm.nvvm.tcgen05.*` - Tensor core intrinsics

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">Expand to see NVVM/LLVM IR key sections</summary>

```llvm
; Thread ID and warp-level operations
%233 = call range(i32 0, 1024) i32 @llvm.nvvm.read.ptx.sreg.tid.x()
%234 = icmp eq i32 %233, 0
%235 = ashr i32 %233, 5
%236 = call i32 @llvm.nvvm.shfl.sync.idx.i32(i32 -1, i32 %235, i32 0, i32 31)
%237 = call { i32, i1 } @llvm.nvvm.elect.sync(i32 -1)

; Mbarrier initialization (async pipeline synchronization)
call void @llvm.nvvm.mbarrier.init.shared(
    ptr addrspace(3) getelementptr inbounds nuw (i8, ptr addrspace(3) @global_smem, i64 82000),
    i32 %241)
call void @llvm.nvvm.mbarrier.init.shared(
    ptr addrspace(3) getelementptr inbounds nuw (i8, ptr addrspace(3) @global_smem, i64 82008),
    i32 %241)

; Cluster-wide fence and barrier
call void asm sideeffect "fence.mbarrier_init.release.cluster;", "n"(i32 0)
call void @llvm.nvvm.barrier.cta.sync.aligned.all(i32 0)

; Async copy from global to shared memory (cp.async)
%1478 = select i1 %1459, i32 16, i32 0
call void @llvm.nvvm.cp.async.cg.shared.global.16.s(
    ptr addrspace(3) %1477, ptr addrspace(1) %1451, i32 %1478)
call void @llvm.nvvm.cp.async.cg.shared.global.16.s(
    ptr addrspace(3) %1485, ptr addrspace(1) %1452, i32 %1486)

; Signal mbarrier arrival after async copy
call void @llvm.nvvm.cp.async.mbarrier.arrive.noinc.shared(ptr addrspace(3) %1535)

; TCGEN05 tensor core intrinsics
; Allocate tensor memory
%tmem = call i32 @llvm.nvvm.tcgen05.alloc(i32 65536)

; Load data into tensor memory
call void @llvm.nvvm.tcgen05.ld(i32 %tmem, ptr addrspace(3) %smem_ptr, i32 %size)

; Execute TCGEN05 MMA (128x256x64 tile)
call void @llvm.nvvm.tcgen05.mma(i32 %tmem_a, i32 %tmem_b, i32 %tmem_c)

; Fence and wait for tensor core completion
call void @llvm.nvvm.tcgen05.fence()
call void @llvm.nvvm.tcgen05.wait()
```

</details>

## SASS

The final output is SASS.

**Key SASS instructions:**
- `HMMA.16816.F32.BF16` - Half-precision matrix multiply-accumulate
- `TCGEN05.MMA` - Tensor core MMA
- `TCGEN05.LD.S` - Tensor memory load
- `UTCPMULTI` / `LDG` - Global memory loads
- `SYNCS.EXCH` - Async synchronization exchange
- `FENCE.VIEW.ASYNC.S` - Async memory fence

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">Expand to see SASS key sections</summary>

```nasm
; SASS - MoE kernel (fused_moe_kernel)
; Target: sm_120a

; Thread ID and CTA setup
/*0020*/    S2R R0, SR_TID.X ;                  ; Get thread ID
/*0060*/    S2UR UR8, SR_CgaCtaId ;             ; Get CTA ID (uniform reg)

; Async fence and mbarrier sync (cluster sync)
/*0110*/    FENCE.VIEW.ASYNC.S ;
/*0120*/    SYNCS.EXCH.64 URZ, [UR8+0x14050], UR4 ;
/*0130*/    SYNCS.EXCH.64 URZ, [UR8+0x14058], UR4 ;
/*0140*/    SYNCS.EXCH.64 URZ, [UR8+0x14060], UR6 ;

; ... (data loading, address calculation) ...

; Tensor core HMMA - 16x8x16 BF16→F32 matrix multiply
; R156 = A matrix fragment (reused across 7 HMMAs)
; R124,R120,R116,R112,R108,R104,R100 = B matrix fragments
; R200,R204,R64,R60,R56,R52,R48 = accumulator tiles
/*4a00*/    HMMA.16816.F32.BF16 R200, R156, R124, R200 ;
/*4a10*/    HMMA.16816.F32.BF16 R204, R156, R120, R204 ;
/*4a20*/    HMMA.16816.F32.BF16 R64, R156, R116, R64 ;
/*4a30*/    HMMA.16816.F32.BF16 R60, R156, R112, R60 ;
/*4a40*/    HMMA.16816.F32.BF16 R56, R156, R108, R56 ;
/*4a50*/    HMMA.16816.F32.BF16 R52, R156, R104, R52 ;
/*4a60*/    HMMA.16816.F32.BF16 R48, R156, R100, R48 ;

; Second A fragment (R148) with different B fragments
/*4a70*/    HMMA.16816.F32.BF16 R200, R148, R126, R200 ;
/*4a80*/    HMMA.16816.F32.BF16 R204, R148, R122, R204 ;
/*4a90*/    HMMA.16816.F32.BF16 R64, R148, R118, R64 ;
```

</details>

---

# The TileIR passes

TileIR runs multiple passes to transform your code. The passes are grouped by the scope they operate on:

{% include image.html path="/assets/images/posts/2026-01-29/pass_flow.svg" width="100%" text="TileIR pass pipeline" %}

{% include image.html path="/assets/images/posts/2026-01-29/pass_glossary.svg" width="100%" text="Detailed pass pipeline: cuda_tile.entry → nv_tileaa.func (×12) → builtin.module → gpu.module" %}

---

### Pass 1: `cuda_tile.entry`

Entry point canonicalization—validates kernel structure, emits compile-time constants for tile sizes/strides, propagates input constraints via `assume` operations, creates tensor views, and establishes memory ordering via `make_token`.

---

### Pass 2: `nv_tileaa.func` (×12 iterations)

Iterative lowering from cuda_tile to nv_tileaa. First iteration converts `make_tensor_view` → `make_memref`, `get_tile_block_id` → `get_program_id`, `mmaf` → `dot`, decomposes `load_view_tko` into `block_tile` + `tiled_load` + `view`. Subsequent iterations perform refinement and optimization. Final iteration emits precision conversions (`fp_to_fp`), adds kernel metadata, and prepares for async pipeline lowering.

---

### Pass 3: `builtin.module`

Module-level transforms and nv_tileas emission—creates async pipeline operations, software pipelines for overlapping compute/memory, producer-consumer synchronization, TMA descriptors, and double buffers.

---

### Pass 4: `gpu.module`

Final lowering to NVVM/LLVM—converts `nv_tileas.dot` → `nvvm.mma.sync`, lowers async ops to barrier/fence instructions, converts memory ops to NVVM intrinsics (`ldmatrix`, `cp.async`, `mbarrier.*`), and emits address space annotations.

## Complete Pass Catalog

Below is a catalog of passes that run within the TileIR pipeline.

### Conversion Passes

{% include fancy_table.html
    first_load="false"
    px="4"
    py="2"
    id="conversion-passes-table"
    headers="Pass Name,Source,Target,Description"
    data="convert-cudatile-to-tileaa,cuda_tile,nv_tileaa,Frontend: CuTile DSL to TileAA abstract assembly
    convert-tileaa-to-tileas,nv_tileaa,nv_tileas,Middle-end: Abstract to scheduled assembly
    convert-nv-tileas-to-llvm,nv_tileas,llvm,Backend: TileAS to LLVM IR
    convert-nv-tile-func-to-llvm,nv_tile,llvm,Convert tile function ops to LLVM
    convert-gpu-to-nvvm,gpu,nvvm,GPU dialect to NVVM intrinsics
    convert-scf-to-cf,scf,cf,Structured control flow to basic blocks
    nv-tile-ir-convert-target-to-nvvm,nv_tile,nvvm,Target-specific ops to NVVM
    convert-pipeline-to-nvvm,pipeline,nvvm,Async pipeline ops to NVVM barriers
    convert-arith-to-llvm,arith,llvm,Arithmetic operations to LLVM
    convert-cf-to-llvm,cf,llvm,Control flow to LLVM
    convert-to-llvm,*,llvm,Generic catch-all LLVM conversion
    convert-math-to-llvm,math,llvm,Math operations to LLVM
    convert-nvvm-to-llvm,nvvm,llvm,NVVM intrinsics to LLVM
    convert-ub-to-llvm,ub,llvm,Undefined behavior ops to LLVM
    convert-vector-to-llvm,vector,llvm,Vector ops to LLVM
    convert-debuginfo-to-llvm,debug,llvm,Debug info to LLVM metadata"
%}

### TileAS Optimization Passes

{% include fancy_table.html
    first_load="false"
    px="4"
    py="2"
    id="tileas-passes-table"
    headers="Pass Name,Description"
    data="tileas-assign-dot-layouts,Assign optimal data layouts for dot (MMA) operations
    tileas-assign-pipeline-layouts,Assign layouts for async pipeline stages
    tileas-assign-load-store-layouts,Assign layouts for memory operations
    tileas-attach-tma-desc-args,Attach TMA descriptor arguments to kernel signature
    tileas-dynamic-persistent,Enable dynamic persistent kernel execution
    tileas-insert-OCG-knobs,Insert Online Code Generation tuning knobs
    tileas-legalize-tmem-copy,Legalize tensor memory copy operations
    tileas-plan-cta,Plan CTA (thread block) configuration
    tileas-remove-buffer-alias,Remove buffer aliasing for optimization
    tileas-remove-dead-args,Dead argument elimination
    tileas-remove-layout-conversions,Remove unnecessary layout conversions
    tileas-resolve-agent-boundary,Resolve warp specialization agent boundaries
    tileas-slicing,Tensor slicing for pipelining
    tileas-materialize-async,Materialize async load/store/dot operations
    tileas-materialize-convert-layout,Materialize layout conversion copy atoms
    tileas-materialize-schedule,Materialize schedule to warp-specialized IR
    tileas-unroll-register-loops,Unroll loops at register level
    tileas-unspecialized-pipeline,Handle non-warp-specialized pipelines
    tileas-optimize-alloc-tensor,Optimize tensor allocation placement
    tileas-optimize-reduce,Optimize reduction operations
    tileas-recompute-for-scheduling,Recompute values for better scheduling
    tileas-legalize-fma-dot,Legalize FMA in dot products
    tileas-legalize-reduce,Legalize reduction operations
    tileas-slice-and-fuse,Slice and fuse operations for locality
    tileas-refine-atom-by-resource,Refine copy atoms based on resource constraints
    tileas-generate-schedule,Generate execution schedule (Serial or CostBased)
    tileas-prepare-for-scheduling,Prepare IR for scheduling pass
    tileas-optimize-dot-accumulation,Optimize dot product accumulation
    lower-tma-load-store-to-async,Lower TMA ops to async variants
    tileas-print-decomposed-tv-layout,Debug: print decomposed tensor view layouts"
%}

---

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">Conversion Patterns Registered</summary>

The TileAA→TileAS conversion registers 20+ patterns:

```cpp
TileAAToTileASTiledLoadOpPattern      // Tiled load conversion
TileAAToTileASDotOpPattern            // Dot product conversion
TileAAToTileASExtractOpPattern        // Extraction conversion
TileAAToTileASBroadcastOpPattern      // Broadcast conversion
TileAAToTileASGatherLoadOpPattern     // Gather load conversion
TileAAToTileASScatterStoreOpPattern   // Scatter store conversion
TileAAToTileASExpandDimsOpPattern     // Dimension expansion
TileAAToTileASExtractSliceOpPattern   // Slice extraction
TileAAToTileASGenerateOpPattern       // Generate conversion
TileAAToTileASLoadOpPattern           // Load conversion
TileAAToTileASPermuteOpPattern        // Permute conversion
TileAAToTileASReduceOpPattern         // Reduce conversion
TileAAToTileASScanOpPattern           // Scan conversion
TileAAToTileASStoreOpPattern          // Store conversion
TileAAToTileASTiledAtomicRMWOpPattern // Atomic RMW conversion
TileAAToTileASTiledStoreOpPattern     // Tiled store conversion
TileAAToTileASViewOpPattern           // View conversion
TileAAToTileASYieldOpPattern          // Yield conversion
```

</details>

---

# Conclusion

TileIR is a sophisticated MLIR-based compiler that progressively lowers high-level tensor operations to optimized GPU machine code. It's an interesting piece of software that combines MLIR and the rest of NVIDIA's toolchain to make the tile abstraction work.

**Resources:**
- [CuTile Python](https://github.com/NVIDIA/cutile-python)
- [CUDA Tile](https://github.com/NVIDIA/cuda-tile)
- [NVIDIA TileIR Documentation](https://docs.nvidia.com/cuda/tile-ir/)

---

# Appendix: TileIR Passes Reference

This appendix documents the TileIR-specific passes in the compilation pipeline. Passes are organized into categories: **Conversion** and **TileAS Optimization**

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">Conversion Passes (16)</summary>

Conversion passes transform IR between MLIR dialects.

### convert-cudatile-to-tileaa

Converts high-level `cuda_tile` dialect to `nv_tileaa`.

**Key transformations:**
- `cuda_tile.mmaf` → `nv_tileaa.dot`
- `cuda_tile.load_view_tko` → `nv_tileaa.tiled_load`
- `cuda_tile.store_ptr_tko` → `nv_tileaa.tiled_store`
- `cuda_tile.for` → `scf.for` + `nv_tileaa.yield`

```cpp
void ConvertCudaTileToTileAA::runOnOperation() {
    ModuleOp module = getOperation();
    ConversionTarget target(getContext());
    target.addLegalDialect<nv_tileaa::NVTileAADialect>();
    target.addIllegalDialect<cuda_tile::CudaTileDialect>();

    RewritePatternSet patterns(&getContext());
    // Register 20+ conversion patterns
    patterns.add<ConvertMmafToDot>(...);
    patterns.add<ConvertLoadViewTko>(...);
    patterns.add<ConvertStorePtr>(...);

    applyPartialConversion(module, target, std::move(patterns));
}
```

---

### convert-tileaa-to-tileas

Main middle-end conversion: `nv_tileaa` → `nv_tileas` (Tile Assembly).

**Key transformations:**
- `nv_tileaa.tiled_load` → `nv_tileas.async_load` + pipeline ops
- `nv_tileaa.dot` → `nv_tileas.dot` with layout annotations
- Inserts shared memory allocations

```cpp
void ConvertTileAAToTileAS::runOnOperation() {
    FuncOp funcOp = getOperation();

    // Walk all tileaa operations
    funcOp.walk([&](nv_tileaa::TiledLoadOp loadOp) {
        // Create async copy with TMA descriptor
        auto asyncCopy = builder.create<nv_tileas::AsyncCopyOp>(...);

        // Allocate shared memory buffer
        auto smemAlloc = builder.create<nv_tileas::AllocSharedOp>(...);
    });

    funcOp.walk([&](nv_tileaa::DotOp dotOp) {
        // Convert to tileas.dot with layout attributes
        auto tiledDot = builder.create<nv_tileas::DotOp>(...);
        tiledDot->setAttr("lhs_layout", selectMMALayout(...));
    });
}
```

---

### convert-nv-tileas-to-llvm

Backend code generation: `nv_tileas` → LLVM IR with NVVM intrinsics.

**Key transformations:**
- `tileas.tcgen05_mma` → `@llvm.nvvm.tcgen05.mma.*`
- `tileas.tcgen05_ld` → `@llvm.nvvm.tcgen05.ld.*`
- `tileas.async_copy` → `@llvm.nvvm.cp.async.*`
- Barrier ops → `@llvm.nvvm.barrier.*`

```cpp
void ConvertTileASToLLVM::runOnOperation() {
    ModuleOp module = getOperation();

    ConversionTarget target(getContext());
    target.addLegalDialect<LLVM::LLVMDialect>();

    RewritePatternSet patterns(&getContext());

    // MMA operations
    patterns.add<Tcgen05MMAToNVVM>([](tcgen05::MMAOp op) {
        // Generate NVVM MMA intrinsic
        return builder.create<NVVM::Tcgen05MMAOp>(...);
    });

    // Memory operations with TMA
    patterns.add<Tcgen05LoadToNVVM>([](tcgen05::LoadOp op) {
        return builder.create<NVVM::Tcgen05LoadOp>(...);
    });
}
```

---

### convert-gpu-to-nvvm

Converts GPU dialect operations to NVVM intrinsics.

| GPU Op | NVVM Intrinsic |
|--------|----------------|
| `gpu.thread_id` | `nvvm.read.ptx.sreg.tid.*` |
| `gpu.block_id` | `nvvm.read.ptx.sreg.ctaid.*` |
| `gpu.block_dim` | `nvvm.read.ptx.sreg.ntid.*` |
| `gpu.barrier` | `nvvm.barrier0` |

---

### convert-pipeline-to-nvvm

Converts async pipeline operations to NVVM barrier intrinsics.

| Pipeline Op | NVVM Op |
|-------------|---------|
| `pipeline.producer_acquire` | `nvvm.mbarrier.arrive.*` |
| `pipeline.producer_commit` | `nvvm.mbarrier.arrive.*` + phase |
| `pipeline.consumer_wait` | `nvvm.mbarrier.wait.*` |
| `pipeline.consumer_release` | `nvvm.mbarrier.arrive.*` |

---

</details>

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">TileAS Optimization Passes (30)</summary>

TileAS passes optimize and schedule tile operations.

### tileas-assign-dot-layouts

Assigns MMA-compatible layouts to dot product operands.

```cpp
void AssignDotLayouts::runOnOperation() {
    FuncOp funcOp = getOperation();

    funcOp.walk([&](DotOp dotOp) {
        auto lhsType = dotOp.getLhs().getType();
        auto rhsType = dotOp.getRhs().getType();

        // Select MMA shape based on types
        MMAShape mmaShape = selectMMAShape(lhsType, rhsType);

        // Assign layouts for operands
        Layout lhsLayout = computeLhsLayout(mmaShape, lhsType);
        Layout rhsLayout = computeRhsLayout(mmaShape, rhsType);

        dotOp->setAttr("lhs_layout", lhsLayout);
        dotOp->setAttr("rhs_layout", rhsLayout);
    });
}
```

**MMA shapes:** `m16n8k16`, `m16n16k16`, `m64n256k64`

---

### tileas-assign-load-store-layouts

Optimizes memory access patterns for coalesced loads.

```cpp
void AssignLoadStoreLayouts::runOnOperation() {
    FuncOp funcOp = getOperation();

    funcOp.walk([&](LoadOp loadOp) {
        auto tensorType = loadOp.getResult().getType();

        // Check for TMA opportunity
        if (canUseTMA(loadOp)) {
            Layout tmaLayout = computeTMALayout(tensorType);
            loadOp->setAttr("layout", tmaLayout);
            loadOp->setAttr("use_tma", true);
        } else {
            // Vectorized load layout
            Layout vecLayout = computeVectorizedLayout(tensorType);
            loadOp->setAttr("layout", vecLayout);
        }
    });
}
```

---

### tileas-assign-pipeline-layouts

Assigns layouts for async pipeline buffers.

```cpp
void AssignPipelineLayouts::runOnOperation() {
    FuncOp funcOp = getOperation();

    funcOp.walk([&](PipelineOp pipelineOp) {
        for (auto& stage : pipelineOp.getStages()) {
            // Assign shared memory layouts for buffers
            for (auto buffer : stage.getBuffers()) {
                Layout smemLayout = computeSwizzledLayout(buffer);
                buffer->setAttr("layout", smemLayout);
            }
        }
    });
}
```

---

### tileas-generate-schedule

Generates execution schedule using cost-based or serial scheduler.

```cpp
void GenerateSchedule::runOnOperation() {
    FuncOp funcOp = getOperation();

    // Build dependency graph
    DependencyGraph depGraph(funcOp);

    // Select scheduler based on options
    Scheduler* scheduler;
    if (useCostBasedScheduler) {
        scheduler = new CostBasedScheduler(depGraph);
    } else {
        scheduler = new SerialScheduler(depGraph);
    }

    // Generate schedule
    Schedule schedule = scheduler->generateSchedule();

    // Apply schedule to IR
    applySchedule(funcOp, schedule);
}
```

**Scheduler types:**
- `Serial`: Topological order
- `CostBased`: Latency-aware with heuristics

---

### tileas-materialize-schedule

Materializes abstract schedule into warp-specialized IR.

```cpp
void MaterializeSchedule::runOnOperation() {
    FuncOp funcOp = getOperation();

    Schedule schedule = getSchedule(funcOp);

    if (schedule.getStrategy() == Strategy::WarpSpecialize) {
        // Split into producer/consumer
        auto [producerOps, consumerOps] = partitionOps(funcOp, schedule);

        // Create agent regions
        createAgentRegion(producerOps, AgentRole::Producer);
        createAgentRegion(consumerOps, AgentRole::Consumer);

        // Insert synchronization
        insertBarriers(funcOp, schedule);
    }
}
```

---

### tileas-materialize-async

Creates async pipeline structure with multi-buffering.

```cpp
void MaterializeAsync::runOnOperation() {
    FuncOp funcOp = getOperation();
    int numStages = getOption("num-stages");

    funcOp.walk([&](scf::ForOp forOp) {
        if (canPipeline(forOp)) {
            // Create N buffers for N-stage pipeline
            SmallVector<Value> buffers;
            for (int i = 0; i < numStages; i++) {
                buffers.push_back(allocateBuffer(forOp));
            }

            // Transform loop body
            emitPrologue(forOp, buffers);
            emitSteadyState(forOp, buffers);
            emitEpilogue(forOp, buffers);
        }
    });
}
```

---

### tileas-materialize-convert-layout

Expands layout conversions to actual data movement.

```cpp
void MaterializeConvertLayout::runOnOperation() {
    FuncOp funcOp = getOperation();

    funcOp.walk([&](ConvertLayoutOp convertOp) {
        auto srcLayout = getLayout(convertOp.getSource());
        auto dstLayout = getLayout(convertOp.getResult());

        // Generate shuffle or shared memory path
        if (canUseShuffles(srcLayout, dstLayout)) {
            emitShuffleConversion(convertOp);
        } else {
            emitSharedMemoryConversion(convertOp);
        }
    });
}
```

---

### tileas-attach-tma-desc-args

Injects TMA descriptor arguments into kernel signatures.

```cpp
void AttachTMADescArgs::runOnOperation() {
    FuncOp funcOp = getOperation();

    SmallVector<TMAOp> tmaOps;
    funcOp.walk([&](Operation* op) {
        if (usesTMA(op)) tmaOps.push_back(op);
    });

    for (auto& tmaOp : tmaOps) {
        // Create TMA descriptor type
        auto descType = TMADescriptorType::get(
            tmaOp.getShape(),
            tmaOp.getElementType(),
            tmaOp.getSwizzle()
        );

        // Add to function arguments
        funcOp.insertArgument(descType, "tma_desc");
    }
}
```

---

### tileas-slicing

Slices tensors for pipelined execution.

```cpp
void TileASSlicing::runOnOperation() {
    FuncOp funcOp = getOperation();

    funcOp.walk([&](LoadOp loadOp) {
        auto tensorType = loadOp.getResult().getType();
        int sliceDim = getSliceDimension(loadOp);
        int sliceSize = computeSliceSize(tensorType, sliceDim);

        // Replace single load with sliced loads
        SmallVector<Value> slices;
        for (int i = 0; i < numSlices; i++) {
            auto slice = builder.create<SlicedLoadOp>(
                loadOp.getSource(), sliceDim, i * sliceSize, sliceSize
            );
            slices.push_back(slice);
        }
    });
}
```

---

### tileas-plan-cta

Plans CTA (thread block) configuration.

```cpp
void PlanCTA::runOnOperation() {
    FuncOp funcOp = getOperation();

    // Analyze resource requirements
    int smemRequired = analyzeSharedMemory(funcOp);
    int regsRequired = analyzeRegisters(funcOp);

    // Compute optimal CTA shape
    CTAConfig config = computeCTAConfig(
        smemRequired, regsRequired, targetOccupancy
    );

    funcOp->setAttr("cta_shape", config.toAttribute());
}
```

---

### tileas-resolve-agent-boundary

Resolves data flow across warp specialization boundaries.

```cpp
void ResolveAgentBoundary::runOnOperation() {
    FuncOp funcOp = getOperation();

    funcOp.walk([&](AgentSwitchOp switchOp) {
        // Identify values crossing boundary
        SmallVector<Value> crossingValues;
        for (Value v : switchOp.getOperands()) {
            if (crossesBoundary(v, switchOp)) {
                crossingValues.push_back(v);
            }
        }

        // Insert shared memory communication
        for (Value v : crossingValues) {
            insertSharedMemoryTransfer(v, switchOp);
        }
    });
}
```

---

### tileas-remove-buffer-alias

Removes buffer aliasing using fixed-point iteration.

```cpp
void RemoveBufferAlias::runOnOperation() {
    FuncOp funcOp = getOperation();

    bool changed = true;
    while (changed) {
        changed = false;
        funcOp.walk([&](AllocTensorOp allocOp) {
            for (auto& use : allocOp.getResult().getUses()) {
                if (isAliasingUse(use)) {
                    createNonAliasingBuffer(use);
                    changed = true;
                }
            }
        });
    }
}
```

---

### tileas-remove-dead-args

Removes unused arguments from region operations.

---

### tileas-remove-layout-conversions

Eliminates redundant layout conversions.

```cpp
void RemoveLayoutConversions::runOnOperation() {
    FuncOp funcOp = getOperation();

    funcOp.walk([&](ConvertLayoutOp convertOp) {
        auto srcLayout = getLayout(convertOp.getSource());
        auto dstLayout = getLayout(convertOp.getResult());

        // Remove identity conversions
        if (srcLayout == dstLayout) {
            convertOp.replaceAllUsesWith(convertOp.getSource());
            convertOp.erase();
        }
    });
}
```

---

### tileas-optimize-alloc-tensor

Optimizes tensor allocations through reuse and elimination.

```cpp
void OptimizeAllocTensor::runOnOperation() {
    FuncOp funcOp = getOperation();
    LivenessAnalysis liveness(funcOp);

    SmallVector<AllocTensorOp> allocs;
    funcOp.walk([&](AllocTensorOp op) { allocs.push_back(op); });

    for (auto& alloc : allocs) {
        // Find reusable buffer
        if (auto reusable = findReusableBuffer(alloc, liveness)) {
            reuseBuffer(alloc, reusable);
        }
    }
}
```

---

### tileas-optimize-reduce

Optimizes reduction operations with warp shuffle or shared memory.

```cpp
void OptimizeReduce::runOnOperation() {
    FuncOp funcOp = getOperation();

    funcOp.walk([&](ReduceOp reduceOp) {
        int reductionSize = getReductionSize(reduceOp);

        if (reductionSize <= 32) {
            setAtom(reduceOp, "warp_shuffle");
        } else if (reductionSize <= 1024) {
            setAtom(reduceOp, "shared_memory");
        } else {
            setAtom(reduceOp, "multi_stage");
        }
    });
}
```

---

### tileas-optimize-dot-accumulation

Optimizes MMA accumulation patterns for better register utilization.

```cpp
void OptimizeDotAccumulation::runOnOperation() {
    FuncOp funcOp = getOperation();

    funcOp.walk([&](DotOp dotOp) {
        auto accumPattern = analyzeAccumulationPattern(dotOp);

        switch (accumPattern) {
            case AccumPattern::SimpleLoop:
                optimizeSimpleAccumulation(dotOp);
                break;
            case AccumPattern::SplitK:
                optimizeSplitKAccumulation(dotOp);
                break;
            case AccumPattern::StreamK:
                optimizeStreamKAccumulation(dotOp);
                break;
        }
    });
}
```

---

### tileas-recompute-for-scheduling

Trades recomputation for reduced register pressure.

```cpp
void TileASRecomputeForScheduling::runOnOperation() {
    FuncOp funcOp = getOperation();
    RegisterPressureAnalysis regPressure(funcOp);

    funcOp.walk([&](Operation* op) {
        for (Value result : op->getResults()) {
            if (shouldRecompute(result, regPressure)) {
                markForRecomputation(result);
            }
        }
    });
    applyRecomputations(funcOp);
}

bool shouldRecompute(Value v, RegisterPressureAnalysis& rpa) {
    // Recompute if value is cheap but keeping it live causes spills
    int computeCost = estimateComputeCost(v.getDefiningOp());
    int spillCost = rpa.estimateSpillCost(v);
    return computeCost < spillCost;
}
```

---

### tileas-legalize-fma-dot

Ensures FMA operations match hardware capabilities.

```cpp
void LegalizeFmaDot::runOnOperation() {
    FuncOp funcOp = getOperation();

    funcOp.walk([&](DotOp dotOp) {
        if (hasFmaAccumulation(dotOp)) {
            legalizeFma(dotOp);
        }
    });
}

void legalizeFma(DotOp dotOp) {
    auto accType = dotOp.getAccumulator().getType();

    if (!isLegalAccumulatorType(accType)) {
        auto legalType = getLegalAccumulatorType(accType);
        insertAccumulatorConversion(dotOp, legalType);
    }

    if (isMixedPrecision(dotOp)) {
        legalizeMixedPrecisionFma(dotOp);
    }
}
```

---

### tileas-legalize-reduce

Ensures reductions use supported types and sizes.

```cpp
void LegalizeReduce::runOnOperation() {
    FuncOp funcOp = getOperation();

    funcOp.walk([&](ReduceOp reduceOp) {
        if (!isLegalReduction(reduceOp)) {
            legalizeReduction(reduceOp);
        }
    });
}

void legalizeReduction(ReduceOp reduceOp) {
    auto inputType = reduceOp.getInput().getType();
    auto reductionKind = reduceOp.getReductionKind();

    if (!isSupportedElementType(inputType.getElementType())) {
        insertTypeConversion(reduceOp);
    }
    if (!isSupportedReductionSize(inputType, reduceOp.getReductionDim())) {
        splitReduction(reduceOp);
    }
}
```

---

### tileas-legalize-tmem-copy

Legalizes tensor memory (tmem) copy operations. Tensor memory is dedicated storage for tensor core operands.

```cpp
void TileASLegalizeTmemCopy::runOnOperation() {
    FuncOp funcOp = getOperation();

    funcOp.walk([&](Operation* op) {
        if (auto copyOp = dyn_cast<CopyOp>(op)) {
            if (involvesTmem(copyOp)) {
                legalizeTmemCopy(copyOp);
            }
        }
    });
}

void legalizeTmemCopy(CopyOp copyOp) {
    auto srcLayout = getLayout(copyOp.getSource());
    auto dstLayout = getLayout(copyOp.getDest());

    // Infer register layout from tmem layout
    auto regLayout = inferRegisterLayoutFromTmem(srcLayout);

    // Insert necessary layout conversions
    if (needsConversion(srcLayout, regLayout)) {
        insertLayoutConversion(copyOp, srcLayout, regLayout);
    }
}
```

---

### tileas-slice-and-fuse

Applies loop tiling (slicing) and fusion for improved data locality.

```cpp
void SliceAndFuse::runOnOperation() {
    FuncOp funcOp = getOperation();

    SmallVector<FusionGroup> fusionGroups;
    collectFusionCandidates(funcOp, fusionGroups);

    for (auto& group : fusionGroups) {
        auto sliceSize = computeOptimalSliceSize(group);
        sliceOperations(group, sliceSize);
        fuseOperations(group);
    }
}

void fuseOperations(FusionGroup& group) {
    // Create fused loop nest
    // - Single loop iterating over slices
    // - Multiple operations per slice iteration
    auto fusedLoop = createFusedLoop(group);

    for (auto* op : group.getOperations()) {
        moveIntoFusedLoop(op, fusedLoop);
    }
}
```

---

### tileas-refine-atom-by-resource

Adjusts operation granularity ("atom") based on available hardware resources.

```cpp
void RefineAtomByResource::runOnOperation() {
    FuncOp funcOp = getOperation();
    auto resources = getTargetResources(funcOp);

    funcOp.walk([&](Operation* op) {
        if (hasAtomAttribute(op)) {
            refineAtom(op, resources);
        }
    });
}

void refineAtom(Operation* op, ResourceConstraints& resources) {
    auto currentAtom = getAtom(op);

    int smemRequired = estimateSmemUsage(op, currentAtom);
    int regsRequired = estimateRegUsage(op, currentAtom);

    // Refine if over resource limits (SM120: 228KB smem, 65536 regs)
    if (smemRequired > resources.maxSmem ||
        regsRequired > resources.maxRegs) {
        auto refinedAtom = findSmallerAtom(op, resources);
        setAtom(op, refinedAtom);
    }
}
```

---

### tileas-prepare-for-scheduling

Normalizes IR and annotates operation latencies for the scheduler.

```cpp
void PrepareForScheduling::runOnOperation() {
    FuncOp funcOp = getOperation();

    normalizeLoops(funcOp);
    insertSchedulingAnchors(funcOp);
    annotateLatencies(funcOp);
    identifyBarriers(funcOp);
}

void annotateLatencies(FuncOp funcOp) {
    funcOp.walk([&](Operation* op) {
        int latency = estimateLatency(op);
        op->setAttr("sched.latency",
                    builder.getI64IntegerAttr(latency));
    });
}
```

---

### tileas-unroll-register-loops

Unrolls loops that access register-resident tensors (required since GPU registers cannot be dynamically indexed).

```cpp
void TileASUnrollRegisterLoops::runOnOperation() {
    FuncOp funcOp = getOperation();

    funcOp.walk([&](scf::ForOp forOp) {
        if (accessesRegisterTensors(forOp)) {
            if (!canAvoidUnroll(forOp)) {
                // Must unroll - register tensors require static indexing
                unrollLoop(forOp);
            }
        }
    });
}

bool accessesRegisterTensors(scf::ForOp forOp) {
    bool accessesRegs = false;
    forOp.walk([&](Operation* op) {
        for (Value operand : op->getOperands()) {
            if (isRegisterTensor(operand)) {
                accessesRegs = true;
            }
        }
    });
    return accessesRegs;
}
```

---

### tileas-unspecialized-pipeline

Implements software pipelining without warp specialization (all warps do both load and compute).

```cpp
void TileASUnspecializedPipeline::runOnOperation() {
    FuncOp funcOp = getOperation();
    int numStages = getOption<int>("unspecialized-pipeline-num-stages");

    funcOp.walk([&](scf::ForOp forOp) {
        if (canPipeline(forOp)) {
            applySoftwarePipelining(forOp, numStages);
        }
    });
}

void applySoftwarePipelining(scf::ForOp forOp, int numStages) {
    emitPrologue(forOp, numStages);    // Pre-load data for first N iterations
    emitSteadyState(forOp, numStages); // Overlap load(i+N) with compute(i)
    emitEpilogue(forOp, numStages);    // Drain remaining computations
}
```

---

### tileas-dynamic-persistent

Transforms kernels into dynamic persistent kernels that process work items from a queue.

```cpp
void TileASDynamicPersistent::runOnOperation() {
    FuncOp funcOp = getOperation();

    if (funcOp->hasAttr("dynamic_persistent")) {
        emitWarning("Kernel is already dynamic persistent");
        return;
    }

    transformToPersistent(funcOp);
    funcOp->setAttr("dynamic_persistent", builder.getUnitAttr());
}

void transformToPersistent(FuncOp funcOp) {
    // Insert outer loop that fetches work items:
    // while (workAvailable()) {
    //     workItem = fetchWork();
    //     processWorkItem(workItem);
    //     signalCompletion();
    // }
}
```

---

### tileas-insert-OCG-knobs

Inserts OCG (Optimizing Code Generator) hints for the PTXAS backend.

```cpp
void TileASInsertOCGKnobs::runOnOperation() {
    FuncOp funcOp = getOperation();

    funcOp.walk([&](Operation* op) {
        if (auto loopOp = dyn_cast<LoopOp>(op)) {
            insertOCGDirectives(loopOp);
        }
        if (auto mmaOp = dyn_cast<DotOp>(op)) {
            insertMMAOptimizationHints(mmaOp);
        }
    });
}

void insertOCGDirectives(Operation* op) {
    op->setAttr("ocgEnterDirectives",
                buildOCGDirectives(op, /*enter=*/true));
    op->setAttr("ocgLeaveDirectives",
                buildOCGDirectives(op, /*enter=*/false));
}
```

</details>

---

# Appendix: IR Dumps

This appendix contains the IR dumps from the MoE kernel compilation. Some of the IR below uses `%0` placeholders.

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">cuda_tile IR</summary>

```llvm
// cuda_tile dialect operations
// High-level tensor operations from CuTile Python API


// === Pass #1 scope=cuda_tile.entry ===
"cuda_tile.module"() {1 regions}
"cuda_tile.entry"() {1 regions}
%0 = "cuda_tile.constant"() : () -> (ct.view)
%0 = "cuda_tile.constant"() : () -> (ct.view)
%0 = "cuda_tile.constant"() : () -> (ct.view)
%0 = "cuda_tile.constant"() : () -> (ct.view)
%0 = "cuda_tile.constant"() : () -> (ct.view)
%0 = "cuda_tile.constant"() : () -> (ct.view)
%0 = "cuda_tile.constant"() : () -> (ct.view)
%0 = "cuda_tile.assume"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%cuda_tile.assume) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%cuda_tile.assume) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%cuda_tile.assume) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%cuda_tile.assume) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%cuda_tile.assume) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%cuda_tile.assume) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%cuda_tile.assume) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%cuda_tile.assume) : (ct.view) -> (ct.view)
%0 = "cuda_tile.make_tensor_view"(%cuda_tile.assume, %cuda_tile.assume, %cuda_tile.assume, %cuda_tile.assume, %cuda_tile.assume, %cuda_tile.assume) : (ct.view, ct.view, ct.view, ct.view, ct.view, ct.view) -> (ct.token)
%0 = "cuda_tile.assume"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%cuda_tile.assume) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%cuda_tile.assume) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%cuda_tile.assume) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%cuda_tile.assume) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%cuda_tile.assume) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%cuda_tile.assume) : (ct.view) -> (ct.view)
%0 = "cuda_tile.assume"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.make_tensor_view"(%cuda_tile.assume, %cuda_tile.assume) : (ct.view, ct.view) -> (ct.token)
%0 = "cuda_tile.make_token"() : () -> (ct.ptr)
%0, %1, %2 = "cuda_tile.get_tile_block_id"() : () -> (ct.view, ct.view, ct.view)
%0 = "cuda_tile.divi"(%cuda_tile.assume, %cuda_tile.constant) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.divi"(%cuda_tile.assume, %cuda_tile.constant) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.muli"(%cuda_tile.constant, %cuda_tile.divi) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.divi"(%cuda_tile.get_tile_block_id, %cuda_tile.muli) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.muli"(%cuda_tile.divi, %cuda_tile.constant) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.subi"(%cuda_tile.divi, %cuda_tile.muli) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.mini"(%cuda_tile.subi, %cuda_tile.constant) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.remi"(%cuda_tile.get_tile_block_id, %cuda_tile.mini) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.cmpi"(%cuda_tile.remi, %cuda_tile.constant) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.cmpi"(%cuda_tile.mini, %cuda_tile.constant) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.xori"(%cuda_tile.cmpi, %cuda_tile.cmpi) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.cmpi"(%cuda_tile.remi, %cuda_tile.constant) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.andi"(%cuda_tile.xori, %cuda_tile.cmpi) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.addi"(%cuda_tile.remi, %cuda_tile.mini) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.select"(%cuda_tile.andi, %cuda_tile.addi, %cuda_tile.remi) : (ct.view, ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.addi"(%cuda_tile.muli, %cuda_tile.select) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.remi"(%cuda_tile.get_tile_block_id, %cuda_tile.muli) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.cmpi"(%cuda_tile.remi, %cuda_tile.constant) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.cmpi"(%cuda_tile.muli, %cuda_tile.constant) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.xori"(%cuda_tile.cmpi, %cuda_tile.cmpi) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.cmpi"(%cuda_tile.remi, %cuda_tile.constant) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.andi"(%cuda_tile.xori, %cuda_tile.cmpi) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.addi"(%cuda_tile.remi, %cuda_tile.muli) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.select"(%cuda_tile.andi, %cuda_tile.addi, %cuda_tile.remi) : (ct.view, ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.divi"(%cuda_tile.select, %cuda_tile.mini) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.muli"(%cuda_tile.addi, %cuda_tile.constant) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.iota"() : () -> (ct.view)
%0 = "cuda_tile.reshape"(%cuda_tile.muli) : (ct.view) -> (ct.view)
%0 = "cuda_tile.broadcast"(%cuda_tile.reshape) : (ct.view) -> (ct.view)
%0 = "cuda_tile.addi"(%cuda_tile.broadcast, %cuda_tile.iota) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.exti"(%cuda_tile.addi) : (ct.view) -> (ct.view)
%0 = "cuda_tile.exti"(%cuda_tile.assume) : (ct.view) -> (ct.view)
%0 = "cuda_tile.reshape"(%cuda_tile.exti) : (ct.view) -> (ct.view)
%0 = "cuda_tile.broadcast"(%cuda_tile.reshape) : (ct.view) -> (ct.view)
%0 = "cuda_tile.cmpi"(%cuda_tile.exti, %cuda_tile.broadcast) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.reshape"(%cuda_tile.assume) : (ct.view) -> (ct.view)
%0 = "cuda_tile.broadcast"(%cuda_tile.reshape) : (ct.view) -> (ct.view)
%0 = "cuda_tile.offset"(%cuda_tile.broadcast, %cuda_tile.exti) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.reshape"(%cuda_tile.constant) : (ct.view) -> (ct.view)
%0 = "cuda_tile.broadcast"(%cuda_tile.reshape) : (ct.view) -> (ct.view)
%0, %1 = "cuda_tile.load_ptr_tko"(%cuda_tile.offset, %cuda_tile.cmpi, %cuda_tile.broadcast, %cuda_tile.make_token) : (ct.view, ct.view, ct.view, ct.ptr) -> (ct.view, ct.ptr)
%0 = "cuda_tile.reshape"(%arg) : (ct.view) -> (ct.view)
%0 = "cuda_tile.broadcast"(%cuda_tile.reshape) : (ct.view) -> (ct.view)
%0 = "cuda_tile.divi"(%cuda_tile.load_ptr_tko, %cuda_tile.broadcast) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.make_partition_view"(%cuda_tile.make_tensor_view) : (ct.token) -> (ct.part)
%0, %1 = "cuda_tile.load_view_tko"(%cuda_tile.make_partition_view, %cuda_tile.addi, %cuda_tile.make_token) : (ct.part, ct.view, ct.ptr) -> (ct.view, ct.ptr)
%0 = "cuda_tile.reshape"(%cuda_tile.load_view_tko) : (ct.view) -> (ct.view)
%0 = "cuda_tile.divi"(%cuda_tile.assume, %cuda_tile.constant) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.iota"() : () -> (ct.view)
%0 = "cuda_tile.reshape"(%cuda_tile.divi) : (ct.view) -> (ct.view)
%0 = "cuda_tile.exti"(%cuda_tile.assume) : (ct.view) -> (ct.view)
%0 = "cuda_tile.reshape"(%cuda_tile.exti) : (ct.view) -> (ct.view)
%0 = "cuda_tile.broadcast"(%cuda_tile.reshape) : (ct.view) -> (ct.view)
%0 = "cuda_tile.exti"(%cuda_tile.assume) : (ct.view) -> (ct.view)
%0 = "cuda_tile.reshape"(%cuda_tile.exti) : (ct.view) -> (ct.view)
%0 = "cuda_tile.broadcast"(%cuda_tile.reshape) : (ct.view) -> (ct.view)
%0 = "cuda_tile.exti"(%cuda_tile.assume) : (ct.view) -> (ct.view)
%0 = "cuda_tile.reshape"(%cuda_tile.exti) : (ct.view) -> (ct.view)
%0 = "cuda_tile.broadcast"(%cuda_tile.reshape) : (ct.view) -> (ct.view)
%0 = "cuda_tile.reshape"(%cuda_tile.assume) : (ct.view) -> (ct.view)
%0 = "cuda_tile.broadcast"(%cuda_tile.reshape) : (ct.view) -> (ct.view)
%0 = "cuda_tile.reshape"(%cuda_tile.constant) : (ct.view) -> (ct.view)
%0 = "cuda_tile.broadcast"(%cuda_tile.reshape) : (ct.view) -> (ct.view)
%0 = "cuda_tile.for"(%cuda_tile.constant, %cuda_tile.divi, %cuda_tile.constant, %cuda_tile.constant) {1 regions} : (ct.view, ct.view, ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.muli"(%arg, %cuda_tile.constant) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.reshape"(%cuda_tile.muli) : (ct.view) -> (ct.view)
%0 = "cuda_tile.broadcast"(%cuda_tile.reshape) : (ct.view) -> (ct.view)
%0 = "cuda_tile.addi"(%cuda_tile.broadcast, %cuda_tile.iota) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.reshape"(%cuda_tile.addi) : (ct.view) -> (ct.view)
%0 = "cuda_tile.exti"(%cuda_tile.reshape) : (ct.view) -> (ct.view)
%0 = "cuda_tile.broadcast"(%cuda_tile.exti) : (ct.view) -> (ct.view)
%0 = "cuda_tile.cmpi"(%cuda_tile.broadcast, %cuda_tile.broadcast) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.muli"(%cuda_tile.broadcast, %cuda_tile.broadcast) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.exti"(%cuda_tile.reshape) : (ct.view) -> (ct.view)
%0 = "cuda_tile.broadcast"(%cuda_tile.exti) : (ct.view) -> (ct.view)
%0 = "cuda_tile.cmpi"(%cuda_tile.broadcast, %cuda_tile.broadcast) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.andi"(%cuda_tile.cmpi, %cuda_tile.cmpi) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.addi"(%cuda_tile.muli, %cuda_tile.broadcast) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.offset"(%cuda_tile.broadcast, %cuda_tile.addi) : (ct.view, ct.view) -> (ct.view)
%0, %1 = "cuda_tile.load_ptr_tko"(%cuda_tile.offset, %cuda_tile.andi, %cuda_tile.broadcast, %cuda_tile.make_token) : (ct.view, ct.view, ct.view, ct.ptr) -> (ct.view, ct.ptr)
%0 = "cuda_tile.make_partition_view"(%cuda_tile.make_tensor_view) : (ct.token) -> (ct.part)
%0, %1 = "cuda_tile.load_view_tko"(%cuda_tile.make_partition_view, %cuda_tile.reshape, %arg, %cuda_tile.divi, %cuda_tile.make_token) : (ct.part, ct.view, ct.view, ct.view, ct.ptr) -> (ct.view, ct.ptr)
%0 = "cuda_tile.reshape"(%cuda_tile.load_view_tko) : (ct.view) -> (ct.view)
%0 = "cuda_tile.mmaf"(%cuda_tile.load_ptr_tko, %cuda_tile.reshape, %arg) : (ct.view, ct.view, ct.view) -> (ct.view)
"cuda_tile.continue"(%cuda_tile.mmaf) : (ct.view) -> ()
%0 = "cuda_tile.muli"(%cuda_tile.divi, %cuda_tile.constant) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.iota"() : () -> (ct.view)
%0 = "cuda_tile.reshape"(%cuda_tile.muli) : (ct.view) -> (ct.view)
%0 = "cuda_tile.broadcast"(%cuda_tile.reshape) : (ct.view) -> (ct.view)
%0 = "cuda_tile.addi"(%cuda_tile.broadcast, %cuda_tile.iota) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.ftof"(%cuda_tile.for) : (ct.view) -> (ct.view)
%0 = "cuda_tile.reshape"(%cuda_tile.load_ptr_tko) : (ct.view) -> (ct.view)
%0 = "cuda_tile.reshape"(%cuda_tile.addi) : (ct.view) -> (ct.view)
%0 = "cuda_tile.exti"(%cuda_tile.reshape) : (ct.view) -> (ct.view)
%0 = "cuda_tile.broadcast"(%cuda_tile.exti) : (ct.view) -> (ct.view)
%0 = "cuda_tile.exti"(%cuda_tile.assume) : (ct.view) -> (ct.view)
%0 = "cuda_tile.reshape"(%cuda_tile.exti) : (ct.view) -> (ct.view)
%0 = "cuda_tile.broadcast"(%cuda_tile.reshape) : (ct.view) -> (ct.view)
%0 = "cuda_tile.cmpi"(%cuda_tile.broadcast, %cuda_tile.broadcast) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.exti"(%cuda_tile.assume) : (ct.view) -> (ct.view)
%0 = "cuda_tile.reshape"(%cuda_tile.exti) : (ct.view) -> (ct.view)
%0 = "cuda_tile.broadcast"(%cuda_tile.reshape) : (ct.view) -> (ct.view)
%0 = "cuda_tile.muli"(%cuda_tile.broadcast, %cuda_tile.broadcast) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.exti"(%cuda_tile.reshape) : (ct.view) -> (ct.view)
%0 = "cuda_tile.broadcast"(%cuda_tile.exti) : (ct.view) -> (ct.view)
%0 = "cuda_tile.exti"(%cuda_tile.assume) : (ct.view) -> (ct.view)
%0 = "cuda_tile.reshape"(%cuda_tile.exti) : (ct.view) -> (ct.view)
%0 = "cuda_tile.broadcast"(%cuda_tile.reshape) : (ct.view) -> (ct.view)
%0 = "cuda_tile.cmpi"(%cuda_tile.broadcast, %cuda_tile.broadcast) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.andi"(%cuda_tile.cmpi, %cuda_tile.cmpi) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.addi"(%cuda_tile.muli, %cuda_tile.broadcast) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.reshape"(%cuda_tile.assume) : (ct.view) -> (ct.view)
%0 = "cuda_tile.broadcast"(%cuda_tile.reshape) : (ct.view) -> (ct.view)
%0 = "cuda_tile.offset"(%cuda_tile.broadcast, %cuda_tile.addi) : (ct.view, ct.view) -> (ct.view)
%0 = "cuda_tile.store_ptr_tko"(%cuda_tile.offset, %cuda_tile.ftof, %cuda_tile.andi, %cuda_tile.make_token) : (ct.view, ct.view, ct.view, ct.ptr) -> (ct.ptr)
"cuda_tile.return"()
```

</details>

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">nv_tileaa IR</summary>

```llvm
// nv_tileaa dialect operations
// Tile-level ops (architecture-independent)


// === Pass #1 scope=nv_tileaa.func ===
"nv_tileaa.func"() {nv_tileaa.kernel_spec} {1 regions}
%0 = "nv_tileaa.assume"(%arg) : (aa.memref) -> (aa.memref)
%0 = "nv_tileaa.assume"(%arg) : (iN) -> (iN)
%0 = "nv_tileaa.assume"(%nv_tileaa.assume) : (iN) -> (iN)
%0 = "nv_tileaa.assume"(%arg) : (iN) -> (iN)
%0 = "nv_tileaa.assume"(%nv_tileaa.assume) : (iN) -> (iN)
%0 = "nv_tileaa.assume"(%arg) : (iN) -> (iN)
%0 = "nv_tileaa.assume"(%nv_tileaa.assume) : (iN) -> (iN)
%0 = "nv_tileaa.assume"(%arg) : (aa.memref) -> (aa.memref)
%0 = "nv_tileaa.assume"(%arg) : (iN) -> (iN)
%0 = "nv_tileaa.assume"(%nv_tileaa.assume) : (iN) -> (iN)
%0 = "nv_tileaa.assume"(%arg) : (iN) -> (iN)
%0 = "nv_tileaa.assume"(%nv_tileaa.assume) : (iN) -> (iN)
%0 = "nv_tileaa.splat"(%nv_tileaa.assume) : (iN) -> (tensor<...>)
%0 = "nv_tileaa.assume"(%arg) : (iN) -> (iN)
%0 = "nv_tileaa.assume"(%nv_tileaa.assume) : (iN) -> (iN)
%0 = "nv_tileaa.splat"(%nv_tileaa.assume) : (iN) -> (tensor<...>)
%0 = "nv_tileaa.assume"(%arg) : (iN) -> (iN)
%0 = "nv_tileaa.assume"(%nv_tileaa.assume) : (iN) -> (iN)
%0 = "nv_tileaa.assume"(%arg) : (iN) -> (iN)
%0 = "nv_tileaa.assume"(%nv_tileaa.assume) : (iN) -> (iN)
%0 = "nv_tileaa.assume"(%arg) : (aa.memref) -> (aa.memref)
%0 = "nv_tileaa.assume"(%arg) : (iN) -> (iN)
%0 = "nv_tileaa.assume"(%nv_tileaa.assume) : (iN) -> (iN)
%0 = "nv_tileaa.assume"(%arg) : (iN) -> (iN)
%0 = "nv_tileaa.assume"(%nv_tileaa.assume) : (iN) -> (iN)
%0 = "nv_tileaa.assume"(%arg) : (iN) -> (iN)
%0 = "nv_tileaa.assume"(%nv_tileaa.assume) : (iN) -> (iN)
%0 = "nv_tileaa.assume"(%arg) : (aa.memref) -> (aa.memref)
%0 = "nv_tileaa.assume"(%arg) : (iN) -> (iN)
%0 = "nv_tileaa.assume"(%nv_tileaa.assume) : (iN) -> (iN)
%0 = "nv_tileaa.splat"(%nv_tileaa.assume) : (iN) -> (tensor<...>)
%0 = "nv_tileaa.assume"(%arg) : (aa.memref) -> (aa.memref)
%0 = "nv_tileaa.assume"(%arg) : (iN) -> (iN)
%0 = "nv_tileaa.assume"(%nv_tileaa.assume) : (iN) -> (iN)
%0 = "nv_tileaa.make_memref"(%nv_tileaa.assume, %nv_tileaa.assume, %nv_tileaa.assume, %nv_tileaa.assume, %nv_tileaa.assume, %nv_tileaa.assume) : (aa.memref, iN, iN, iN, iN, iN) -> (aa.btile)
%0 = "nv_tileaa.make_memref"(%nv_tileaa.assume, %nv_tileaa.assume) : (aa.memref, iN) -> (aa.btile)
%0 = "nv_tileaa.create_mem_token"() : () -> (aa.ptr)
%0 = "nv_tileaa.get_program_id"() : () -> (iN)
%0 = "nv_tileaa.splat"(%nv_tileaa.get_program_id) : (iN) -> (tensor<...>)
%0 = "nv_tileaa.make_range"(%arith.constant, %arith.constant) : (iN, iN) -> (tensor<...>)
%0 = "nv_tileaa.extract"(%arith.muli) : (tensor<...>) -> (iN)
%0 = "nv_tileaa.splat"(%nv_tileaa.extract) : (iN) -> (tensor<...>)
%0 = "nv_tileaa.extract"(%arith.extsi) : (tensor<...>) -> (iN)
%0 = "nv_tileaa.splat"(%nv_tileaa.extract) : (iN) -> (tensor<...>)
%0 = "nv_tileaa.splat"(%nv_tileaa.assume) : (aa.memref) -> (tensor<...>)
%0 = "nv_tileaa.addptr"(%nv_tileaa.splat, %arith.extsi) : (tensor<...>, tensor<...>) -> (tensor<...>)
%0, %1 = "nv_tileaa.load"(%nv_tileaa.addptr, %arith.cmpi, %arith.constant, %nv_tileaa.create_mem_token) : (tensor<...>, tensor<...>, tensor<...>, aa.ptr) -> (tensor<...>, aa.ptr)
%0 = "nv_tileaa.splat"(%arg) : (iN) -> (tensor<...>)
%0 = "nv_tileaa.block_tile"(%nv_tileaa.make_memref) : (aa.btile) -> (aa.mtoken)
%0 = "nv_tileaa.extract"(%arith.addi) : (tensor<...>) -> (iN)
%0, %1 = "nv_tileaa.tiled_load"(%nv_tileaa.block_tile, %nv_tileaa.extract, %nv_tileaa.create_mem_token) : (aa.mtoken, iN, aa.ptr) -> (tensor<...>, aa.ptr)
%0 = "nv_tileaa.view"(%nv_tileaa.tiled_load) : (tensor<...>) -> (tensor<...>)
%0 = "nv_tileaa.make_range"(%arith.constant, %arith.constant) : (iN, iN) -> (tensor<...>)
%0 = "nv_tileaa.expand_dims"(%arith.floordivsi) : (tensor<...>) -> (tensor<...>)
%0 = "nv_tileaa.splat"(%arith.extsi) : (iN) -> (tensor<...>)
%0 = "nv_tileaa.splat"(%arith.extsi) : (iN) -> (tensor<...>)
%0 = "nv_tileaa.splat"(%arith.extsi) : (iN) -> (tensor<...>)
%0 = "nv_tileaa.splat"(%nv_tileaa.assume) : (aa.memref) -> (tensor<...>)
%0 = "nv_tileaa.extract"(%arith.ceildivsi) : (tensor<...>) -> (iN)
%0 = "nv_tileaa.splat"(%arg) : (iN) -> (tensor<...>)
%0 = "nv_tileaa.extract"(%arith.muli) : (tensor<...>) -> (iN)
%0 = "nv_tileaa.splat"(%nv_tileaa.extract) : (iN) -> (tensor<...>)
%0 = "nv_tileaa.expand_dims"(%arith.addi) : (tensor<...>) -> (tensor<...>)
%0 = "nv_tileaa.broadcast"(%arith.extsi) : (tensor<...>) -> (tensor<...>)
%0 = "nv_tileaa.broadcast"(%arith.extsi) : (tensor<...>) -> (tensor<...>)
%0 = "nv_tileaa.addptr"(%nv_tileaa.splat, %arith.addi) : (tensor<...>, tensor<...>) -> (tensor<...>)
%0, %1 = "nv_tileaa.load"(%nv_tileaa.addptr, %arith.andi, %arith.constant, %nv_tileaa.create_mem_token) : (tensor<...>, tensor<...>, tensor<...>, aa.ptr) -> (tensor<...>, aa.ptr)
%0 = "nv_tileaa.block_tile"(%nv_tileaa.make_memref) : (aa.btile) -> (aa.mtoken)
%0 = "nv_tileaa.extract"(%nv_tileas.convert_layout) : (tensor<...>) -> (iN)
%0 = "nv_tileaa.extract"(%arith.floordivsi) : (tensor<...>) -> (iN)
%0, %1 = "nv_tileaa.tiled_load"(%nv_tileaa.block_tile, %nv_tileaa.extract, %arg, %nv_tileaa.extract, %nv_tileaa.create_mem_token) : (aa.mtoken, iN, iN, iN, aa.ptr) -> (tensor<...>, aa.ptr)
%0 = "nv_tileaa.view"(%nv_tileaa.tiled_load) : (tensor<...>) -> (tensor<...>)
%0 = "nv_tileaa.dot"(%nv_tileaa.load, %nv_tileaa.view, %arg) : (tensor<...>, tensor<...>, tensor<...>) -> (tensor<...>)
%0 = "nv_tileaa.make_range"(%arith.constant, %arith.constant) : (iN, iN) -> (tensor<...>)
%0 = "nv_tileaa.extract"(%arith.muli) : (tensor<...>) -> (iN)
%0 = "nv_tileaa.splat"(%nv_tileaa.extract) : (iN) -> (tensor<...>)
%0 = "nv_tileaa.fp_to_fp"(%scf.for) : (tensor<...>) -> (tensor<...>)
%0 = "nv_tileaa.expand_dims"(%nv_tileaa.load) : (tensor<...>) -> (tensor<...>)
%0 = "nv_tileaa.expand_dims"(%arith.addi) : (tensor<...>) -> (tensor<...>)
%0 = "nv_tileaa.broadcast"(%arith.extsi) : (tensor<...>) -> (tensor<...>)
%0 = "nv_tileaa.splat"(%arith.extsi) : (iN) -> (tensor<...>)
%0 = "nv_tileaa.splat"(%arith.extsi) : (iN) -> (tensor<...>)
%0 = "nv_tileaa.broadcast"(%arith.extsi) : (tensor<...>) -> (tensor<...>)
%0 = "nv_tileaa.splat"(%arith.extsi) : (iN) -> (tensor<...>)
%0 = "nv_tileaa.splat"(%nv_tileaa.assume) : (aa.memref) -> (tensor<...>)
%0 = "nv_tileaa.addptr"(%nv_tileaa.splat, %arith.addi) : (tensor<...>, tensor<...>) -> (tensor<...>)
%0 = "nv_tileaa.store"(%nv_tileaa.addptr, %nv_tileaa.fp_to_fp, %arith.andi, %nv_tileaa.create_mem_token) : (tensor<...>, tensor<...>, tensor<...>, aa.ptr) -> (aa.ptr)
"nv_tileaa.return"()

// === Pass #2 scope=nv_tileaa.func ===
// === Pass #3 scope=nv_tileaa.func ===
// === Pass #4 scope=nv_tileaa.func ===
// === Pass #5 scope=nv_tileaa.func ===
// === Pass #6 scope=nv_tileaa.func ===
// === Pass #7 scope=nv_tileaa.func ===
// === Pass #8 scope=nv_tileaa.func ===
// === Pass #9 scope=nv_tileaa.func ===
// === Pass #10 scope=nv_tileaa.func ===
// === Pass #11 scope=nv_tileaa.func ===

// === Pass #12 scope=nv_tileaa.func ===
// (Lines 193-352 - final assembly with fp_to_fp conversions)
// See dump for complete content including:
// - 32 fp_to_fp operations for output precision conversion
// - Multiple nv_tileaa.func declarations with kernel metadata
// - Final memory layout preparation
```

</details>

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">nv_tileas IR</summary>

```llvm
// nv_tileas dialect operations
// Tile-level Scheduled Assembly (architecture-specific)


// [within nv_tileaa.func pass]
%0, %1 = "nv_tileas.load"(%nv_tileaa.addptr, %arith.cmpi, %arith.constant, %nv_tileaa.create_mem_token) : (tensor<...>, tensor<...>, tensor<...>, aa.ptr) -> (tensor<...>, aa.ptr)
%0, %1 = "nv_tileas.tiled_load"(%nv_tileaa.block_tile, %nv_tileaa.extract, %nv_tileaa.create_mem_token) : (aa.mtoken, iN, aa.ptr) -> (tensor<...>, aa.ptr)
%0 = "nv_tileas.view"(%nv_tileas.tiled_load) : (tensor<...>) -> (tensor<...>)
%0 = "nv_tileas.expand_dims"(%arith.floordivsi) : (tensor<...>) -> (tensor<...>)
%0 = "nv_tileas.expand_dims"(%arith.addi) : (tensor<...>) -> (tensor<...>)
%0 = "nv_tileas.convert_layout"(%nv_tileaa.broadcast) : (tensor<...>) -> (tensor<...>)
%0, %1 = "nv_tileas.load"(%nv_tileaa.addptr, %arith.andi, %arith.constant, %nv_tileaa.create_mem_token) : (tensor<...>, tensor<...>, tensor<...>, aa.ptr) -> (tensor<...>, aa.ptr)
%0 = "nv_tileas.convert_layout"(%nv_tileas.view) : (tensor<...>) -> (tensor<...>)
%0, %1 = "nv_tileas.tiled_load"(%nv_tileaa.block_tile, %nv_tileaa.extract, %arg, %nv_tileaa.extract, %nv_tileaa.create_mem_token) : (aa.mtoken, iN, iN, iN, aa.ptr) -> (tensor<...>, aa.ptr)
%0 = "nv_tileas.view"(%nv_tileas.tiled_load) : (tensor<...>) -> (tensor<...>)
%0 = "nv_tileas.convert_layout"(%nv_tileas.load) : (tensor<...>) -> (tensor<...>)
%0 = "nv_tileas.convert_layout"(%nv_tileas.view) : (tensor<...>) -> (tensor<...>)
%0 = "nv_tileas.convert_layout"(%arg) : (tensor<...>) -> (tensor<...>)
%0 = "nv_tileas.dot"(%nv_tileas.convert_layout, %nv_tileas.convert_layout, %nv_tileas.convert_layout, %arith.constant) : (tensor<...>, tensor<...>, tensor<...>, iN) -> (tensor<...>)
%0 = "nv_tileas.convert_layout"(%nv_tileas.dot) : (tensor<...>) -> (tensor<...>)
%0 = "nv_tileas.make_tiled_tma_desc"(%nv_tileaa.make_memref) {tmaIdx} : (aa.btile) -> (?type)

// [within builtin.module pass]
%0 = "nv_tileas.async.pipeline.create_pipeline"() : () -> (?type)
%0 = "nv_tileas.async.pipeline.create_pipeline"() : () -> (?type)
%0 = "nv_tileas.async.pipeline.create_pipeline"() : () -> (?type)
%0 = "nv_tileas.async.pipeline.create_iterator"(%nv_tileas.async.pipeline.create_pipeline) : (?type) -> (?type)
%0 = "nv_tileas.async.pipeline.create_iterator"(%nv_tileas.async.pipeline.create_pipeline) : (?type) -> (?type)
%0 = "nv_tileas.async.pipeline.create_iterator"(%nv_tileas.async.pipeline.create_pipeline) : (?type) -> (?type)
%0 = "nv_tileas.async.pipeline.create_iterator"(%nv_tileas.async.pipeline.create_pipeline) : (?type) -> (?type)
%0 = "nv_tileas.async.pipeline.create_iterator"(%nv_tileas.async.pipeline.create_pipeline) : (?type) -> (?type)
%0 = "nv_tileas.async.pipeline.create_iterator"(%nv_tileas.async.pipeline.create_pipeline) : (?type) -> (?type)
"nv_tileas.async.pipeline.agent_switch"(%arg, ...) {4 regions} : (...) -> ()

// Producer-Consumer Pattern (repeated throughout)
%0 = "nv_tileas.async.pipeline.producer_acquire"(%arg, %arg) : (?type, ?type) -> (?type)
%0 = "nv_tileas.async.pipeline.inc_iter"(%arg) : (?type) -> (?type)
%0 = "nv_tileas.async.pipeline.producer_write"(%arg, %nv_tileas.async.pipeline.producer_acquire) {1 regions} : (?type, ?type) -> (?type)
"nv_tileas.async.pipeline.producer_commit"(%arg, %nv_tileas.async.pipeline.producer_write) : (?type, ?type) -> ()

%0 = "nv_tileas.async.pipeline.consumer_wait"(%arg, %arg) : (?type, ?type) -> (?type)
%0, %1 = "nv_tileas.async.pipeline.consumer_read"(%arg, %nv_tileas.async.pipeline.consumer_wait) {consumer_idx} {1 regions} : (?type, ?type) -> (?type, tensor<...>)
"nv_tileas.async.pipeline.consumer_release"(%arg, %nv_tileas.async.pipeline.consumer_read) : (?type, ?type) -> ()

// Dot operations (100+ for tiled matrix multiply)
%0 = "nv_tileas.dot"(%nv_tileas.extract_slice, %nv_tileas.extract_slice, %arg, %arith.constant) : (tensor<...>, tensor<...>, tensor<...>, iN) -> (tensor<...>)
// ... (repeated for all tile partitions)

// TMA operations
%0 = "nv_tileas.make_tiled_tma_desc"(%nv_tileaa.make_memref) {tmaIdx} : (aa.btile) -> (?type)
%0 = "nv_tileas.async.tiled_tma_load"(%nv_tileaa.block_tile, %arg, %nv_tileas.make_tiled_tma_desc, %nv_tileaa.extract, %arg, %nv_tileaa.extract) : (...) -> (?type)

// Output assembly (32 insert_slice for output tiles)
%0 = "nv_tileas.insert_slice"(%nv_tileaa.fp_to_fp, %nv_tileas.alloc_tensor, %arith.constant, %arith.constant) : (tensor<...>, tensor<...>, iN, iN) -> (tensor<...>)
// ... (repeated 32 times)
```

</details>

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">NVVM Dialect IR</summary>

```llvm
// nvvm dialect operations
// NVVM (NVIDIA PTX intrinsics in MLIR form)

// === Barrier and Fence Operations ===
"nvvm.fence.mbarrier.init"()
"nvvm.barrier"()
"nvvm.fence.proxy"()

%0 = "nvvm.read.ptx.sreg.clusterid.x"() : () -> (i32)
%0 = "nvvm.read.ptx.sreg.tid.x"() : () -> (i32)

// === Async Global→Shared Copies (136 instances) ===
"nvvm.cp.async.shared.global"(%ptr, %src, %predicate) : (ptr<3>, ptr<1>, i1) -> ()

// === Tensor Core Data Packing (1,088 instances) ===
%0 = "nvvm.cvt.packfloat.f32"(%a, %b, %mode) : (f32, f32, i32) -> (i32)

// === Memory Barriers (66 instances) ===
"nvvm.mbarrier.init.shared"(%barrier, %count) : (ptr<3>, i32) -> ()
"nvvm.mbarrier.arrive.shared"(%barrier) : (ptr<3>) -> ()
"nvvm.mbarrier.wait.shared"(%barrier, %phase) : (ptr<3>, i32) -> ()

// === Matrix Load Operations (512 instances) ===
%0 = "nvvm.ldmatrix"(%ptr) {layout = #nvvm.mma_layout<row>, num = 4}
    : (ptr<3>) -> vector<4xi32>

// === Tensor Core MMA (512 instances) ===
%0 = "nvvm.mma.sync"(%a, %b, %c) {
    layoutA = #nvvm.mma_layout<row>,
    layoutB = #nvvm.mma_layout<col>,
    shape = #nvvm.shape<m = 16, n = 8, k = 16>
} : (vector<4xi32>, vector<2xi32>, vector<4xf32>) -> vector<4xf32>

// ... (2,977 lines total - tensor core operations, barriers, memory ops)
```

</details>

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">LLVM IR / NVVM IR</summary>

```llvm
; ModuleID = 'LLVMDialectModule'
target datalayout = "e-p:64:64:64-p3:32:32:32-i1:8:8-i8:8:8-i16:16:16-i32:32:32-i64:64:64"
target triple = "nvptx64-nvidia-cuda"

; Kernel entry point with TMA descriptors
define ptx_kernel void @fused_moe_kernel(
    ptr addrspace(1) %A,           ; Input tokens
    ptr addrspace(1) %B,           ; Expert weights
    ptr addrspace(1) %C,           ; Output
    ptr addrspace(1) %topk_weights,
    ptr addrspace(1) %sorted_token_ids,
    ptr addrspace(1) %sorted_expert_ids,
    i32 %num_token_replicas,
    i1 %mul_routed_weight,
    ; ... TMA descriptors appended by tileas-attach-tma-desc-args
) #0 {
entry:
    ; Get cluster/block/thread IDs
    %clusterid = call i32 @llvm.nvvm.read.ptx.sreg.clusterid.x()
    %tid = call range(i32 0, 384) i32 @llvm.nvvm.read.ptx.sreg.tid.x()

    ; Initialize barriers for async pipeline
    call void @llvm.nvvm.mbarrier.init.shared(ptr addrspace(3) %barrier, i32 128)

    ; Async copy from global to shared memory
    call void @llvm.nvvm.cp.async.shared.global(
        ptr addrspace(3) %shared_dst,
        ptr addrspace(1) %global_src,
        i32 16,    ; bytes
        i1 %pred   ; predicate
    )

    ; Tensor core matrix multiply
    %result = call <4 x float> @llvm.nvvm.mma.m16n8k16.row.col.f32.f16.f16.f32(
        <4 x i32> %a_frag,
        <2 x i32> %b_frag,
        <4 x float> %c_frag
    )

    ; ... (full pipeline with producer/consumer synchronization)
}

; NVVM intrinsic declarations
declare i32 @llvm.nvvm.read.ptx.sreg.tid.x()
declare i32 @llvm.nvvm.read.ptx.sreg.clusterid.x()
declare void @llvm.nvvm.mbarrier.init.shared(ptr addrspace(3), i32)
declare void @llvm.nvvm.cp.async.shared.global(ptr addrspace(3), ptr addrspace(1), i32, i1)
declare <4 x float> @llvm.nvvm.mma.m16n8k16.row.col.f32.f16.f16.f32(<4 x i32>, <2 x i32>, <4 x float>)
```

</details>

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">PTX Assembly</summary>

{% raw %}
```nasm
//
// Generated by NVIDIA NVVM Compiler
// Cuda compilation tools, release 13.1, V13.1.80
// Based on NVVM 21.0.0
//

.version 9.1
.target sm_120a
.address_size 64

.visible .entry fused_moe_kernel(
    .param .u64 .ptr .global .align 1 fused_moe_kernel_param_0,
    .param .u32 fused_moe_kernel_param_1,
    // ... 31 parameters total including TMA descriptors
    .hidden .param .align 64 .b8 fused_moe_kernel_param_31[128]
)
.reqntid 384
.minnctapersm 1
{
    .reg .pred  %p<306>;
    .reg .b16   %rs<500>;
    .reg .b32   %r<4905>;
    .reg .b64   %rd<348>;

    // 80KB shared memory for double buffering
    .shared .align 128 .b8 global_smem[82032];

    // === Barrier Initialization ===
    mbarrier.init.shared.b64  [global_smem+82000], %r2369;
    mbarrier.init.shared.b64  [global_smem+82008], %r2369;

    // === Matrix Load (ldmatrix for tensor cores) ===
    ldmatrix.sync.aligned.m8n8.x4.shared.b16 {%r4645, %r4646, %r4647, %r4648}, [%r2789];
    ldmatrix.sync.aligned.m8n8.x4.shared.b16 {%r4649, %r4650, %r4651, %r4652}, [%r2793];
    ldmatrix.sync.aligned.m8n8.x4.shared.b16 {%r4653, %r4654, %r4655, %r4656}, [%r2797];
    ldmatrix.sync.aligned.m8n8.x4.shared.b16 {%r4657, %r4658, %r4659, %r4660}, [%r2801];
    // ... (512 ldmatrix instructions total)

    // === Tensor Core MMA (HMMA) ===
    // Note: sm_120a uses wgmma/tcgen05 instructions in SASS
    // PTX shows the portable mma.sync form
    mma.sync.aligned.m16n8k16.row.col.f32.f16.f16.f32
        {%f1, %f2, %f3, %f4},
        {%r4645, %r4646, %r4647, %r4648},
        {%r4709, %r4710},
        {%f1, %f2, %f3, %f4};
    // ... (512 mma.sync instructions total)

    // === Async Copy (cp.async for global→shared) ===
    cp.async.cg.shared.global [%r2856], [%rd112], 16, %p116;
    cp.async.cg.shared.global [%r2857], [%rd113], 16, %p116;
    // ... (136 cp.async instructions total)

    // === Barrier Synchronization ===
    mbarrier.arrive.shared.b64 _, [global_smem+82000];
    mbarrier.try_wait.parity.shared.b64 %p117, [global_smem+82000], %r2371;
}
```
{% endraw %}

</details>

# Citation

To cite this article:

```
@article{zhu2026tileir,
  title = {NVIDIA TileIR Internals: from CuTile to MLIR/LLVM to SASS},
  author = {Zhu, Henry},
  journal = {maknee.github.io},
  year = {2026},
  month = {January},
  url = "https://maknee.github.io/blog/2026/NVIDIA-TileIR-Internals-from-CuTile-to-MLIR-LLVM-to-SASS/"
}
```
