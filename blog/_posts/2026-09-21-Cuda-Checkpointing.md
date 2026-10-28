---
layout:     post
title:      "Making CUDA Checkpointing 15x and gVisor 2x Faster on a B300: A Worklog"
date:       2026-10-29 03:00:00 -0400
summary:    Checkpointing
categories: Checkpointing
thumbnail:  "/assets/images/posts/2025-03-13/thumbnails/thumbnail-1.svg"
comments:   true
perfetto_trace_base: "https://raw.githubusercontent.com/Maknee/maknee.github.io/master/assets/images/posts/2026-09-21/traces/"
tags:
 - Checkpointing
jupyter:    true
mermaid:
    enabled: true
    zoomable: true
---

{% assign pt_card_assets_done = true %}
<link rel="stylesheet" href="{{ '/assets/images/posts/2026-09-21/graphs/dynamic/post.css' | relative_url }}?v={{ site.time | date: '%s' }}">
<script src="{{ '/assets/images/posts/2026-09-21/graphs/dynamic/navigation.js' | relative_url }}?v={{ site.time | date: '%s' }}" defer></script>
<script src="{{ '/assets/images/posts/2026-09-21/graphs/dynamic/perfetto-card.js' | relative_url }}?v={{ site.time | date: '%s' }}" defer></script>

*[Henry Zhu](https://maknee.github.io/) and [Vimarsh Sathia](https://vimarsh.me/)*

# GPU Checkpointing

GPU checkpointing lets an application save its GPU state and later pick up where it left off. This gives us more flexibility in how we run application on top of GPUs. An inference service can release them during quiet periods and resume when traffic returns<span class="sidenote-ref"></span><span class="sidenote">
[Modal: Serverless GPU scaling](https://modal.com/blog/truly-serverless-gpus)<br>
[Doubleword: Faster SGLang cold starts](https://blog.doubleword.ai/fast-sglang-starts)<br>
[Cedana: GPU checkpointing and migration with CRIU](https://cedana.com/blog/criu-gpu-checkpointing/)
</span>.

We wanted to see how far we could push GPU checkpointing and restore out of curiousity and to learn a couple things along the way. We began with the `cuda-checkpoint` implementation on a B300 and spend some time understanding how it works and to understand where the bottlenecks lay. Then we’ll try different ideas to make it faster and see what did and didn't work.

<div id="checkpoint-overview">
{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/charts/plot_overview.svg" width="100%" text="Time reduction with optimizations checkpointing and restoring GLM5.3 on vLLM (Lower is better)" %}
</div>

# gVisor

`cuda-checkpoint` is often paired with another program such as `CRIU`<span class="sidenote-ref"></span><span class="sidenote">[CRIU: GPU checkpointing](https://www.criu.org/GPU_Checkpointing)</span> or `gVisor`<span class="sidenote-ref"></span><span class="sidenote">[gVisor: GPU checkpoint/restore](https://gvisor.dev/docs/user_guide/checkpoint_restore/#gpu-checkpointrestore)<br>
[Modal: Memory snapshots with gVisor](https://modal.com/blog/mem-snapshots)<br>
[Modal: GPU memory snapshots](https://modal.com/blog/gpu-mem-snapshots)</span> to fully serialize the gpu resource and the application itself to disk. Often, one will hear about `sandboxing` or `snapshotting` with these types of applications.

<div id="gvisor-overview">
{% include image.html path="/assets/images/posts/2026-09-21/graphs/gvisor/charts/plot_gvisor_overview.svg" width="100%" text="Checkpoint and restore times GLM-5.3 on vLLM in gVisor for checkpointing and restoring an entire image. We want to show how well optimized cuda-checkpoint runs against the stock implementation under various gVisor flags. <strong style='font-weight: 700'>We do not claim any speedups in gVisor itself</strong>. People may find the graphs for the various flags useful" %}
</div>

We observe a possible 2x speedup by running this version of cuda-checkpoint.

*Takeaways/TLDR*

- Tuning is difficult. There's many types of hardware and system configurations.
  - Hardware makes a difference for application performance where sometimes copies can be 3x faster on one platform.
  - The configuration of the number of threads and buffers difficult as host copy speeds must match up to the PCIE copy speeds.
- It's hard to predict performance without tools. Always have some benchmarks and traces to understand what is going o.
- NUMA affects performance (up to 2x the performance) due to memory being allocated on a different socket
- The two application specific bottlenecks of `cuda-checkpoint` are memory allocation and the number of buffers and threads used for copying data to and from the GPU.
- Find opporunities in parallelize operations

<aside class="post-rail" id="post-rail" aria-label="On this page" hidden>
  <p class="post-rail-label">On this page</p>
  <ol class="post-rail-list" id="post-rail-list"></ol>
</aside>
<button type="button" class="post-rail-toggle" id="post-rail-toggle" aria-controls="post-rail" aria-expanded="false" hidden>
  <span aria-hidden="true">&#9776;</span> Contents
</button>

# How to use cuda-checkpoint

Checkpointing and restoring a CUDA process each take two steps:

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/architecture/lock_unlock.svg" width="100%" text="Overview of checkpointing" %}

To checkpoint, we first **lock** the process's CUDA activity, preventing new work and waiting for existing work to finish. We then **checkpoint** its GPU state into host memory and release its GPU resources<span class="sidenote-ref"></span><span class="sidenote">Although releasing the GPU resources is not necessary for checkpointing, it allows other resource-hungry applications to run on the GPU</span>

In between, another GPU application can utilized the free'd up resources.

To bring it back, we **restore** the GPU resources and copy the saved data back to GPU memory. Finally, we **unlock** the process's CUDA activity so it can submit work again.

NVIDIA’s `cuda-checkpoint` tool exposes these four operations through a simple command-line interface<span class="sidenote-ref"></span><span class="sidenote">This cli communicates using a custom protocol to a cuda process over a pipe. It is a thin wrapper, but impacts latency as shown later</span>:

```bash
ps aux | grep (your gpu application)

cuda-checkpoint --action lock --pid $PID
cuda-checkpoint --action checkpoint --pid $PID
cuda-checkpoint --action restore --pid $PID
cuda-checkpoint --action unlock --pid $PID
```

And this is how it interacts in action:

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/architecture/00-lock-unlock.svg" width="100%" text="Lock, checkpoint, restore, and unlock lifecycle" %}

The API is very similar:

```c
pid_t pid = getpid();

CUcheckpointLockArgs lock_args{0};
cuCheckpointProcessLock(pid, &lock_args);

CUcheckpointCheckpointArgs ckpt_args{0};
cuCheckpointProcessCheckpoint(pid, &ckpt_args);

CUcheckpointRestoreArgs rest_args{0};
cuCheckpointProcessRestore(pid, &rest_args);

CUcheckpointUnlockArgs unlock_args{0};
cuCheckpointProcessUnlock(pid, &unlock_args);

CUprocessState st;
cuCheckpointProcessGetState(pid, &st);
if (st == CU_PROCESS_STATE_CHECKPOINTED) {
    // ...
}
```

This tool only stores the checkpoint image to CPU memory.

## Existing work

Fergus Finn at Doubleword made a ~9 GB checkpoint-and-restore benchmark on an RTX 4090 nearly 4× faster, cutting the time from 4.5 seconds to 1.2 seconds. The improvements came from avoiding repeated CLI initialization, enabling huge pages, preallocating the host buffer, and deferring its cleanup<span class="sidenote-ref"></span><span class="sidenote">[Reverse-engineering NVIDIA's cuda-checkpoint for faster cold starts](https://blog.doubleword.ai/what-happens-when-you-checkpoint-a-cuda-process)</span>. We’ll explore these techniques in more detail, tracing the driver’s internals to explain why they help and which bottlenecks they address. We’ll also apply some of them ourselves and see that the optimizations with CLI, huge pages and preallocating host buffers are useful.

{% include image.html
    path="/assets/images/posts/2026-09-21/graphs/external/doubleword.svg"
    width="100%"
    text="Checkpoint-and-restore optimizations"
    url_source="https://blog.doubleword.ai/what-happens-when-you-checkpoint-a-cuda-process"
    url_text="Fergus Finn / Doubleword"
%}

## What's happening in cuda-checkpoint?

We’ll dig into libcuda<span class="sidenote-ref"></span><span class="sidenote">NVIDIA’s user-space CUDA driver</span> to see what's happening underneath the hood during each step. We want to observe where the time goes through traces<span class="sidenote-ref"></span><span class="sidenote">Each perfetto trace shows a vLLM instance running on two B300s running GLM5-3 flash (~347GB in total). Each GPU instance holds around half the memory (~172GB) and we are checkpointing both gpus, each referred to as a rank</span>.

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">Setup</summary>

{% include fancy_table.html
    first_load="true"
    px="6"
    py="2"
    padx="4"
    pady="4"
    id="checkpoint-setup-table"
    show_calculations="false"
    headers="Setup,Component,Specification"
    data="Host,Number of nodes,1
    ,GPU,8 × NVIDIA B300 SXM6 AC
    ,PCIe,Gen6 x16; one link per GPU
    ,NUMA,GPUs 0–3 on node 0; GPUs 4–7 on node 1
    ,CPU,2 × Intel Xeon Platinum 8559C; 48 cores per socket
    ,Memory,4 TB; 1 TiB container limit; no swap
    ,Driver,580.95.05
    Workload,Model,GLM-5.3-flash
    ,Runtime,vLLM; tensor parallelism 2
    ,GPUs,0 and 1 for every run
    Checkpoint,Per rank,172.74 GB through the capture ring
    ,Driver image per rank,173.85 GB including about 1.1 GB on the native driver path
    Restore,Per rank,173.8 GB"
%}

**Note** Every optimization arm ran as an untraced / traced, although it didn't make much of a difference with tracing on. 

We run GLM-5.3-flash with vLLM 0.30.0 on GPUs 0 and 1 of one B300 host. Tensor parallelism is 2, so each GPU has a worker process, called a rank. We use eager execution, an 8,192-token context limit, and an 8 GiB KV cache per GPU.

```
CUDA_VISIBLE_DEVICES=0,1 python -m vllm.entrypoints.openai.api_server \
  --model /path/to/GLM-5.3-flash \
  --tensor-parallel-size 2 \
  --enforce-eager \
  --max-model-len 8192 \
  --kv-cache-memory-bytes 8589934592

Generation settings go in each request:

{"temperature": 0, "seed": 1234, "max_tokens": 128}
```

We run some requests to see if vLLM is running. The benchmark controller waits until vLLM reports no running or queued requests. The controller starts `cuda-checkpoint --action lock --pid <worker-pid>` for both ranks in parallel and waits for both calls to finish. It does the same for `checkpoint`, `restore`, and `unlock`, in that order. After each cycle, it sends the same three requests and checks that their answers and token IDs match those recorded before checkpointing. 

Our tracing tool uses Frida to attach function-entry and function-return hooks inside both vLLM workers. It also instruments each `cuda-checkpoint` process, so we can see the CLI's setup and request alongside the work inside the target worker. The hooks record driver operations and CPU calls such as `mmap` and `memcpy`. We add GPU counters from NVML, sampled at a target interval of 100 ms, and CPU, memory, and page-fault counters from `/proc`. 

These traces and counters get aggregated into a single perfetto trace output.

</details>

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/checkpoint-baseline.pftrace" id="checkpoint-trace" title="cuda-checkpoint on GLM 5.3 TP=2 on vLLM" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__checkpoint-baseline.json" %}

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/trace-illustrations/checkpoint_overview.svg" width="100%" text="Perfetto dump of GLM5.3 (Rank 0) TP=2 running on vllm" %}

We can see how much time spent locking, checkpointing, restoring and unlocking. Clearly, checkpointing and restoring take up most of the time, so let's zoom into checkpointing.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/trace-illustrations/checkpoint_zoom.svg" width="100%" text="Breakdown of EngineCheckpoint" %}

The checkpointing profile has three main phases: setup, copying, and cleanup. Copying takes up the most of the time. <span class="sidenote-ref"></span><span class="sidenote">Even with the theorical PCIE max bandwidth of 64GB/s on the machine, that would take at least ~2.5s to checkpoint 172GB</span> 

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/trace-illustrations/checkpoint_copying.svg" width="100%" text="Breakdown of copying" %}

It's interesting tha `mmap` is taking longer than copying. We'll revisit this later once we piece everything together.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/trace-illustrations/checkpoint_staging.svg" width="100%" text="Two staging buffers" %}

The copying path allocates a large host buffer with `mmap` and two pinned staging buffers<span class="sidenote-ref"></span><span class="sidenote">Each staging buffer is 2 MB with small pushbuffers for executing the copies</span>. This large buffer holds the final checkpoint image. 

The staging buffers appears to alternate in a double-buffering scheme: while the GPU copies data into one, the CPU copies data from the other into the final checkpoint buffer:

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/architecture/staging.svg" width="100%" text="Double buffering copies from the GPU" %}

The GPU’s DMA engine transfers data from VRAM into one staging buffer while the CPU copies data from the other into the final checkpoint buffer allocated with `mmap`.

So now that we understand the individual parts, taking a step back, we can stitch a more complete picture<span class="sidenote-ref"></span><span class="sidenote">I haven't explained the restore, but intuitively, it should reverse operations of checkpointing</span>:

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/architecture/checkpoint_walkthrough.svg" width="100%" text="A more complete picture given our understanding of the trace" %}

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">How does the engine know what to copy?</summary>

And how does the engine know what to copy? By walking memory manager's blocks and copying its contents from GPU memory to CPU memory.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/architecture/memory_manager.svg" width="100%" text="Double buffering copies from the GPU" %}

Each block tracks its checkpoint state. During checkpointing, its physical GPU memory is freed while its virtual address is preserved. On restore, newly allocated GPU memory is mapped back to that address<span class="sidenote-ref"></span><span class="sidenote">One possible reason for keeping the checkpoint in host memory is to leave full-process serialization to CRIU, which can save the driver's bookkeeping alongside the rest of the process's CPU-side state</span>.

</details>

## Reasoning cuda-checkpoint's design

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/trace-illustrations/checkpoint_copying.svg" width="100%" text="Breakdown of copying" %}

Let's dig into why `cuda-checkpoint` is slow. We have two areas of the checkpoint taking up a good chunk of time. 

`mmap` is called with `mmap(address, total, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS | MAP_FIXED | MAP_POPULATE, -1, 0);`.

The fourth argument includes `MAP_POPULATE`<span class="sidenote-ref"></span><span class="sidenote"><q>Populate (prefault) page tables for a mapping.  For a file mapping, this causes read-ahead on the file.  This will help to reduce blocking on page faults later<q> - [man pages](https://man7.org/linux/man-pages/man2/mmap.2.html)</span> will go ahead and tell the OS to touch every page to page fault. Allocating 173GB of memory twice takes a while.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/trace-illustrations/checkpoint_pcie_slow.svg" width="100%" text="Highlighting PCIE bandwidth" %}

On this B300 node, the theoretical maximum bandwidth of a one way PCIE transfer is 64GB/s. Checkpointing hovers around 6GB/s and restore 3GB/s, an almost 10x and 20x decrease.

Two questions arise here:
- What is causing the checkpointing to be slow? (Is somehow the DMA transfer slow? Is it the CPU copying? Is it the size of the staging buffers?)
- What makes restore slower than checkpointing? We should expect the same bandwidth from both.

The first quesion can be answered by taking a look at the following graph how much time the copy spent calling `memcpy` to drain the staging buffers. If the total time of `memcpy` is small, then the staging buffers are taking too long to fill up. Otherwise, the CPU is taking too long to copy the buffers from the staging buffers into the checkpoint memory. We can see that this is the case below<span class="sidenote-ref"></span><span class="sidenote">You might be wondering why I don't show the `memcpy` in the cuda track. There are hundred of thousands of `memcpy`s in the trace and I wanted to clearly separate it out</span>:

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/trace-illustrations/checkpoint_memcpy.svg" width="100%" text="Time taken by memcpy in the checkpoint" %}

Now we see that bottleneck is the CPU, being a single thread that copies from the buffer.

On to the next question: Why is restore then so much slower? If we take a look at the number of page faults in the restore phase, the trace reports around 800k faults per second for each GPU. If each 4 KiB page copied incurs one fault, that corresponds to:

`1.6 million faults/s × 4,096 bytes/page ÷ 2 GPUs ≈ 3.3 GB/s per GPU`

Which matches the reported PCIE RX GB/s.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/trace-illustrations/checkpoint_restore_page.svg" width="100%" text="Time taken by memcpy in the checkpoint" %}

Why is the number page faults higher? We shouldn't really be page faulting here. We have enough memory ad we're not allocating any memory because we're reusing the checkpoint buffer. I suspect it might be dealing with numa because the system is setup with two sockets:

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/architecture/numa_layout.svg" width="100%" text="NUMA layout of the machine" %}

If we rerun the baseline with some NUMA tracing (reading `/proc/vmstat`), we can see there's local and total NUMA page faults<span class="sidenote-ref"></span><span class="sidenote">NUMA page faults are categorized into local and remote. Local means the page exists on the same CPU node. Remote means that the CPU has to go read the memory through another CPU, incuring cost</span>:

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/trace-illustrations/checkpoint_page_fault.svg" width="100%" text="Measuring NUMA page faults" %}

Local page faults don't incur much cost, but remote page faults indicate that the application is reading memory through another CPU socket. With half of the reads going to through another socket, we can see why the throughput is halved.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/architecture/numa-remote-vs-local.svg" width="80%" text="Place the buffers and workers on the GPU's NUMA node" %}

In this example, both GPUs connect to NUMA node 0. If the buffers are on node 1, GPU transfers must cross the link between sockets. Placing the buffers and workers on node 0 avoids that extra path.

<a id="numa-policy"></a>

Let's see a quick fix by setting mpol to local<span class="sidenote-ref"></span><span class="sidenote">Gives a hint to the kernel to prefer to [allocate memory from the local CPU node](https://www.kernel.org/doc/html/latest/filesystems/tmpfs.html)</span>.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/trace-illustrations/checkpoint_page_fault_fix.svg" width="100%" text="Measuring NUMA page faults with MPOL local" %}

No more remote reads and we see now see that the restore is now equal to the checkpoint (~6Gb/s)!

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/checkpoint-numa.pftrace" id="checkpoint-numa-explain" title="Baseline ran without MPOL Local" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__checkpoint-numa.json" %}

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/checkpoint-numa-mpol.pftrace" id="checkpoint-numa-explain-mpol" title="Baseline ran with MPOL local" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__checkpoint-numa-mpol.json" %}

## Why was cuda-checkpoint designed this way?

The driver cannot assume a particular CPU or pinned-memory budget, keeping compatibility and usability a priority:
- A large worker pool could compete with the application or other checkpointing processes, especially when several GPU processes checkpoint simultaneously. P- inning the entire checkpoint could demand more pinnable memory than the system can support.
- Two small staging buffers and a single copying thread keep those requirements modest<span class="sidenote-ref"></span><span class="sidenote">Each 2 MiB staging buffer matches a common huge-page size. I'm not sure if this is a concidence</span>.
- The newer drivers (as of writing, 2026), allow users to specify what to do with the gpu memory. See [custom storage checkpointing](#new-kid-on-the-block-custom-storage-checkpointing).

# Optimizations for cuda-checkpoint

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/charts/plot_checkpoint_phase_composition.svg" width="100%" text="Breakdown of checkpoint and restore time for each optimization" %}

Each optimization below will break down what the optimization is and have a perfetto trace associated with it<span class="sidenote-ref"></span><span class="sidenote">Each trace shows a GPU checkpoint and restore of a vLLM instance running glm5.3 on two B300s. Each checkpoint and restore is ran multiple times (at least 3). A cycle is locking + checkpointing + restoring + unlocking. The run measurement is the median time taken for a cycle after the first cycle</span>.

## Rewriting the CLI

Why is the CLI slow in the first place<span class="sidenote-ref"></span><span class="sidenote">I was curious from the DoubleWord blog, but it didn't have an explanation</span>? If we take a profile, it becomes immediately obvious:

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/trace-illustrations/checkpoint_lock_slow.svg" width="100%" text="Time taken to lock" %}

The actual work done locking is miniscule compared to time to call the cli to setup and then send the request<span class="sidenote-ref"></span><span class="sidenote">This CLI time is constant. You can observe it for every command. So, every invocation of cuda-checkpoint will have an overhead of at least one second</span>.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/architecture/checkpoint-controller.svg" width="80%" text="Initialize once and reuse the controller" %}

Each CLI call initializes CUDA before it sends a request. We can keep a controller running and reuse it for lock, checkpoint, restore, and unlock. This avoids repeating initialization for each action.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/trace-illustrations/checkpoint_lock_fast.svg" width="80%" text="Time taken to lock improvement" %}

This startup cost matters more as the rest of the cycle gets shorter because this is a decrease in ~4 seconds, one second per action commnad. When we reduce the checkpoint and restore to a couple of seconds, the cli optimization matters more.

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/checkpoint-ckdirect.pftrace" id="checkpoint-before-optimized-ckdirect" title="CLI optimization" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__checkpoint-ckdirect.json" %}

## Huge pages

Let's try out huge pages. It should speed up the `mmap` call to allocate the checkpoint buffer as well as speed up copying a bit.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/architecture/thp.svg" width="80%" text="Larger pages for the same checkpoint buffer" %}

The checkpoint buffer holds the same amount of data. Larger pages mean fewer pages for the kernel to manage. This can reduce the time needed to prepare the buffer before copying starts.

This optimization reduces the time from 118s with the cli optimization to 98s (~1.4x speedup compared to baseline).

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/checkpoint-huge-pages.pftrace" id="checkpoint-thp" title="Huge pages" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__checkpoint-huge-pages.json" %}

## Copying differently

How can we speed up the copying?

### Minimizing page faults

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/trace-illustrations/checkpoint_copying.svg" width="100%" text="Breakdown of copying" %}

`mmap` consumes most the time for copying. Each time a page is allocated, the system page faults to bring in the physical page. We see that for every checkpoint, this consumes ~40s.

Instead, we can just preallocate the page ahead of time and remove that bottleneck.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/architecture/prealloc.svg" width="100%" text="Reuse the host buffer for the next checkpoint" %}

We allocate and populate the host buffer once, then keep it after restore. The next checkpoint reuses this memory, avoiding repeated allocation and cleanup. We still copy the GPU memory into the buffer each time.

This optimization reduces the time per checkpoint + restore cycle from 98 s to 69 s (about ~1.4× faster, and ~1.9x compared to the baseline)

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/checkpoint-preallocation.pftrace" id="checkpoint-preallocated-ring" title="Preallocation" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__checkpoint-preallocation.json" %}

At this point, we've reached about the same result as what's descrbed in the Doubleword blog. We get a ~2x speedup compared to the baseline, which is great! Although the Doubleword blog describes a 4x speedup, we will try to match that and even more so on this node.

### Parallelizing the copy

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/trace-illustrations/checkpoint_copying.svg" width="100%" text="Breakdown of copying" %}

Now that preallocation solves the time spent in the allocation, we can tackle the ~30s spent in copying.

`cuda-checkpoint` uses a single CPU thread to copy data from the staging buffers into the final checkpoint buffer. Can that thread keep up with data arriving over PCIe? We’ll first compare single-threaded and multithreaded CPU-copy bandwidth against GPU-to-host PCIe bandwidth on the same machine.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/charts/plot_xeon_memcpy.svg" width="100%" text="CPU-copy bandwidth with huge pages and preallocation (Higher is better)" %}

We can start by keeping the staging buffers and trying to drain them faster. Multiple CPU workers can each copy part of a completed staging buffer into the final checkpoint buffer, while the GPU fills the other staging buffer.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/architecture/parallel-drain.svg" width="80%" text="Use more CPU workers to copy each staging buffer" %}

Each worker copies a separate part of the completed staging buffer into the checkpoint image. The GPU can fill another staging buffer while the workers finish this copy.

With sixteen staging slots, eight workers take 11.3 s and sixteen workers take 17.0 s. More workers do not always help. This comparison uses warm cycle 2 for eight workers and warm cycle 1 for sixteen workers.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/charts/plot_worker_scaling.svg" width="100%" text="PCIe bandwidth per GPU with 8 or 16 workers and sixteen 2 MiB slots (Higher is better)" %}

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/charts/plot_worker_scaling_time.svg" width="100%" text="Checkpoint-and-restore time with 8 or 16 workers and sixteen 2 MiB slots" %}

<a id="staging-buffer-count"></a>

We can also vary the number of staging buffers.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/architecture/staging-ring.svg" width="100%" text="Copy from pinned staging slots into the host image with four workers" %}

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/charts/plot_slot_scaling.svg" width="80%" text="Checkpoint-and-restore time with eight workers and 2, 8, 16, or 64 staging slots of 2 MiB each" %}

More slots let GPU and CPU copies overlap. With eight workers, increasing the slot count from two to sixteen reduces the full cycle from 35.9 s to 11.3 s (3.2× faster). Increasing it to sixty-four slots raises the cycle time to 12.4 s.

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">Worker and staging-slot traces</summary>

**Vary staging slots — 8 workers**

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/checkpoint-slots-02.pftrace" id="checkpoint-slots-02" title="8 workers, 2 slots × 2 MiB" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__checkpoint-slots-02.json" %}

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/checkpoint-slots-08.pftrace" id="checkpoint-slots-08" title="8 workers, 8 slots × 2 MiB" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__checkpoint-slots-08.json" %}

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/checkpoint-slots-16.pftrace" id="checkpoint-slots-16" title="8 workers, 16 slots × 2 MiB" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__checkpoint-slots-16.json" %}

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/checkpoint-slots-64.pftrace" id="checkpoint-slots-64" title="8 workers, 64 slots × 2 MiB" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__checkpoint-slots-64.json" %}

**Vary workers — compare with the 8-worker, 16-slot run above**

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/checkpoint-workers-16-slots-16.pftrace" id="checkpoint-workers-16-slots-16" title="16 workers, 16 slots × 2 MiB" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__checkpoint-workers-16-slots-16.json" %}

**Ring2-spin — tuned ring settings**

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/checkpoint-staging-slots.pftrace" id="checkpoint-staging-slots" title="Ring2-spin: 16 workers, 16 slots × 8 MiB, node 0" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__checkpoint-staging-slots.json" %}

</details>

### Removing the staging buffers

But can we avoid the CPU copy altogether? Instead of copying through staging buffers, we could copy GPU memory directly into the final checkpoint buffer.

The catch is that the final buffer is pageable host memory. To use it directly for DMA, we need to pin its pages<span class="sidenote-ref"></span><span class="sidenote">Pinning keeps the pages resident at stable physical addresses while the GPU accesses them</span>.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/architecture/staging_pinned.svg" width="100%" text="Copying directly from GPU memory into the pinned checkpoint buffer" %}

This removes the extra CPU copy, but requires pinning the entire checkpoint buffer rather than two small staging buffers<span class="sidenote-ref"></span><span class="sidenote">For a large checkpoint, allocating or registering that much pinned memory may fail</span>.

Direct copying removes the extra CPU copy, but it is slower than using staging buffers. An increase from 8.7s to 11.5s.

Why does should this happen? Wouldn't copying the GPU memory to the final checkpoint buffer be faster than having an intermediate buffer?

The answer lies in how the page tables are setup on the GPU. One calls map the pinned CPU memory by calling `cuMemHostRegister`. Each checkpoint call must register this pinned memory and deregister the pinned memory with `cuMemHostUnregister` during restore<span class="sidenote-ref"></span><span class="sidenote">we must enforce the policy that we release all GPU resources during a checkpoint which includes unmapping the pinned cpu memory</span>.

However, this page table setup is slow. The GPU creates 4KB pages for its PTEs to be mapped to the CPU pages and does this serially through the kernel. It's not that slow, but for 174 GB, this takes up quite a bit of time.

`174 GiB ÷ 4 KiB / 512 entries per page = ~90k calls to kernel to allocate PTEs`

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/architecture/plot_pinned_setup.svg" width="100%" text="Pinned pages setup for checkpointing and restore" %}

You might ask: why not use 2MB pages on the GPU? That isn't supported through `cuMemHostRegister` yet.

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/checkpoint-direct-pinned.pftrace" id="checkpoint-direct-registered-image" title="Direct pinned" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__checkpoint-direct-pinned.json" %}

## Becoming NUMA-aware

As we've seen from analyzing the NUMA bottleneck in the baseline, it can decrease bandwidth by quite a bit if not configured correctly.

To reiterate, GPUs may be connected to one host chip. This chip may be copying memory from this CPU node to another CPU node:

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/architecture/numa_layout.svg" width="100%" text="NUMA layout of the machine" %}

I want to show the results with no options (letting the kernel figure it out for us), forcing all allocations to be on a remote node (the worst case), and forcing the allocations to be only local. Here is that graph with the results:

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/charts/plot_numa_scaling.svg" width="100%" text="NUMA placement: lock, checkpoint, restore, unlock and full-cycle times from Perfetto; warm medians of cycles 1–5" %}

Here I've included two different runs to demonstrate the difference between using the memory allocations on a local node versus a remote node.

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/other/glm-tp2-numa-same-workers-04.pftrace" id="checkpoint-numa-same" title="GPUs on same NUMA node, 4 workers" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__other__glm-tp2-numa-same-workers-04.json" %}

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/other/glm-tp2-numa-split-workers-04.pftrace" id="checkpoint-numa-split" title="GPUs on remote NUMA node, 4 workers" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__other__glm-tp2-numa-split-workers-04.json" %}

Howeever, this didn't show an improvemnt for our system, probably due to MPOL NUMA policy working properly.

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/checkpoint-numa-same.pftrace" id="checkpoint-numa-same-2" title="NUMA-aware same node" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__checkpoint-numa-same.json" %}

## Becoming PCIe link aware

GPUs may share PCIE bandwidth by sharing a root complex<span class="sidenote-ref"></span><span class="sidenote">[Tander poder's blog](https://tanelpoder.com/posts/11m-iops-with-10-ssds-on-amd-threadripper-pro-workstation/#pcie-root-complex-bottleneck) is first how I learned about this type of bottleneck</span>.

This occurs for the B200 for example, unlike the B300.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/architecture/b200-shared-vs-independent-uplinks.svg" width="80%" text="Choose GPUs with separate PCIe uplinks" %}

When two GPUs share one uplink, their transfers compete for its bandwidth. Choosing GPUs with separate uplinks removes that shared-link limit. Both transfers still use the host's memory bandwidth.

Here is a microbenchmark testing the bandwidth with `cudaMemcpyDtoH` and `cudaMemcpyHtoD` with 1GB copies:

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/charts/plot_b200_pcie_links.svg" width="80%" text="B200 PCIe link sharing bandwidth" %}

We see that in the first two bars, we're running with the workload on a single GPU and that hits the PCIE limit. However, in the next two bars, we have two copies happening on two GPUs sharing a root GPU. This results in halving the bandwidth for both GPUs. In the 5th bar, the bandwidth is again at max because those two gpus don't share the same PCIE bandwith.

Separate PCIe links avoid a shared bandwidth limit. Copy bandwidth rises from about 30 GB/s to 55 GB/s per GPU (about 1.8× the bandwidth). These are transfer measurements.

Here's a small bandwidth benchmark measuring the copy throughput at different sizes with inference (either from another process on another GPU that sharing the PCIE bandwidth and another process on the same GPU):

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/charts/plot_b200_pcie_contention.svg" width="80%" text="B200 PCIe copy bandwidth" %}

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">B200 PCIe microbenchmarks</summary>

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/other/b200-pcie-bench-gpu4.pftrace" id="b200-pcie-bench-gpu4" title="B200 PCIe microbenchmark; GPU 4" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__other__b200-pcie-bench-gpu4.json" %}

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/other/b200-pcie-pair-gpus02.pftrace" id="b200-pcie-pair-gpus02" title="B200 PCIe microbenchmark; GPUs 0,2" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__other__b200-pcie-pair-gpus02.json" %}

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/other/b200-pcie-pair-gpus45.pftrace" id="b200-pcie-pair-gpus45" title="B200 PCIe microbenchmark; GPUs 4,5" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__other__b200-pcie-pair-gpus45.json" %}

</details>


<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">B200 workload traces</summary>

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/other/b200-glm-native-gpus0123.pftrace" id="b200-glm-native-gpus0123" title="B200 GPUs 0,1,2,3" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__other__b200-glm-native-gpus0123.json" %}

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/other/b200-glm-native-gpus0245.pftrace" id="b200-glm-native-gpus0245" title="B200 GPUs 0,2,4,5" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__other__b200-glm-native-gpus0245.json" %}

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/other/b200-glm-opt159-gpus0123.pftrace" id="b200-glm-opt159-gpus0123" title="B200 GPUs 0,1,2,3" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__other__b200-glm-opt159-gpus0123.json" %}

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/other/b200-glm-opt159-gpus0245.pftrace" id="b200-glm-opt159-gpus0245" title="B200 GPUs 0,2,4,5" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__other__b200-glm-opt159-gpus0245.json" %}

</details>

But I had an idea: what if we can also utilize the other link if it's not being used for extra bandwidth on a B300 (placing half the weights on GPU 0 and the other half on GPU 4, which are connected to separate NUMAs):

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/architecture/numa-same-vs-split.svg" width="80%" text="Compare one shared NUMA node with one node per rank" %}

This increases the performance slightly: from 9.8s to 9.5s.

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/checkpoint-pcie-split.pftrace" id="checkpoint-pcie-split" title="PCIe split" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__checkpoint-pcie-split.json" %}

## Streaming Stores

Small idea with copies: If we know that the memory being copied to is not going to be reused (cough cough, the staging buffers), then we can optimize the CPU copies even more. By using CPU specific intrinstics, `_mm512_stream_si512`<span class="sidenote-ref"></span><span class="sidenote">[Intel Intrinsics Guide: _mm512_stream_si512](https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm512_stream_si512)</span> for AVX512 (the CPU we test supports AVX512) or `_mm256_stream_si256`<span class="sidenote-ref"></span><span class="sidenote">[Intel Intrinsics Guide: _mm256_stream_si256](https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html#text=_mm256_stream_si256)</span> for AVX2, we can speed up the copy. This gives a hint to the CPU to write directly to memory rather than populating the CPU caches. 

This optimzation reduces the last run from 9.5s to 8.7s, almost a 1s decrease!

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/architecture/plot-streaming.svg" width="100%" text="Streaming stores optimization" %}

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/checkpoint-streaming-stores.pftrace" id="checkpoint-streaming-stores" title="Streaming stores copy" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__checkpoint-streaming-stores.json" %}

## Not-so-generic optimizations

### Blackwell decompression

NVIDIA introduced a dedicated Decompression Engine with Blackwell, announced in March 2024. It is integrated with the copy engine and is supported on B200, B300, GB200 and GB300<span class="sidenote-ref"></span><span class="sidenote">[Blackwell announcement, March 18, 2024](https://nvidianews.nvidia.com/news/nvidia-blackwell-platform-arrives-to-power-a-new-era-of-computing/)<br>
[NVIDIA: Decompression Engine and supported GPUs](https://docs.nvidia.com/cuda/nvcomp/decompression_engine_faq.html)<br>
Software support arrived in nvCOMP 4.2 in February 2025: [release notes](https://docs.nvidia.com/cuda/nvcomp/release_notes.html#nvcomp-4-2-0), [release archive](https://developer.nvidia.com/nvcomp-archive).</span>.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/architecture/10-decompression-a.svg" width="80%" text="Restore raw data over PCIe or transfer compressed data and decompress it on the GPU" %}

A microbenchmark compares the decompression engine bandwidth against nvCOMP kernels running on SMs<span class="sidenote-ref"></span><span class="sidenote">[nvCOMP: NVIDIA's GPU compression and decompression library](https://developer.nvidia.com/nvcomp)</span>.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/charts/plot_blackwell_restore.svg" width="100%" text="Restore bandwidth with Blackwell decompression from host memory versus GPU memory (Higher is better)" %}

The only compression that had gains was `Deflate` (1.28 compression) as well as a huge throughput gain. GFlate and Zstd aren't supported on the B300 hardware (yet).

If we now limit it across the PCIE, we see that the decompression engine has gains beyond the raw transfer bandwidth because the hardware can handle both the copying and decompression.

However, running with nvCOMP kernels to compress the data and using the decompression engine to decompress the data on restore doesn't result in an improvement.

The time per cycle goes from about 9.4 seconds to 12.5 seconds.

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/additional/checkpoint-blackwell-decompression.pftrace" id="blackwell-decompression-glm" title="GLM-5.3 with compression and hardware decompression" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__additional__checkpoint-blackwell-decompression.json" %}

### Skipping zero-filled chunks

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/architecture/zero-page-skip.svg" width="100%" text="Skip zero-filled chunks during transfer and recreate them on the GPU during restore" %}

This is an experiment where zero pages are marked in as a byte in an array instead of sending the entire chunk<span class="sidenote-ref"></span><span class="sidenote">The chunk here is the size of the staging buffer, which I just chose as 64KB</span>. This could potentially speed up the checkpointing and restore as less bytes are sent. However, it seems that the image did not have many chunks containing many zeroes. I was motivated by some older experiments where pytorch or vLLM would manage its own memory allocator by allocating all of its memory up front.

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/additional/checkpoint-zero-page.pftrace" id="checkpoint-zero-page" title="Zero-page skipping" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__additional__checkpoint-zero-page.json" %}

### Incremental checkpointing

Incremental checkpointing is an optimization that takes a snapshot that records only the pages that have been modified. We can do this by running a kernel before hand and then guiding the copy to only copy pages that have been modified.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/architecture/incremental.svg" width="100%" text="Copy only modified memory pages" %}

The red pages have changed since the saved checkpoint. We copy these pages and keep the earlier checkpoint for the unchanged pages. Restore needs both. Finding which pages changed also takes time.

We copy only changed data during checkpointing. This experiment was ran with an AMD CPU.

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/checkpoint/amd/checkpoint-incremental.pftrace" id="checkpoint-epyc-incremental" title="Incremental checkpointing with a full restore (EPYC 9575F)" preview="/assets/images/posts/2026-09-21/traces/previews/blog__checkpoint__amd__checkpoint-incremental.json" %}

## Another platform to run on!

I've ran on AMD to see how it behaves and results in this graph:

{% include image.html path="/assets/images/posts/2026-09-21/graphs/amd/charts/plot_epyc_overview.svg" width="100%" text="Time reduction with optimizations on EPYC 9575F, plus a separate incremental checkpointing run*" %}

We can see that out of the box, the AMD machine behaves with much higher performance. Here is a breakdown of the checkpoint/restore times

{% include image.html path="/assets/images/posts/2026-09-21/graphs/amd/charts/plot_epyc_phase_composition.svg" width="100%" text="Graph comparing the breakdown of each optimization" %}

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">Expand to see the EPYC traces for each step</summary>

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/final/EPYC_9575F/glm-tp2-baseline-numa-sampler.pftrace" id="epyc-stock" title="EPYC: stock" preview="/assets/images/posts/2026-09-21/traces/previews/final__EPYC_9575F__glm-tp2-baseline-numa-sampler.json" %}

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/final/EPYC_9575F/glm-tp2-baseline-ckdirect.pftrace" id="epyc-ckdirect" title="EPYC: CLI optimization" preview="/assets/images/posts/2026-09-21/traces/previews/final__EPYC_9575F__glm-tp2-baseline-ckdirect.json" %}

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/final/EPYC_9575F/glm-tp2-ckdirect-hugepages-shim.pftrace" id="epyc-hugepages" title="EPYC: huge pages with our shim" preview="/assets/images/posts/2026-09-21/traces/previews/final__EPYC_9575F__glm-tp2-ckdirect-hugepages-shim.json" %}

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/final/EPYC_9575F/glm-tp2-preallocated-unpinned.pftrace" id="epyc-preallocated" title="EPYC: preallocated host memory" preview="/assets/images/posts/2026-09-21/traces/previews/final__EPYC_9575F__glm-tp2-preallocated-unpinned.json" %}

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/final/EPYC_9575F/glm-tp2-numa-node0.pftrace" id="epyc-numa-policy" title="EPYC: NUMA policy" preview="/assets/images/posts/2026-09-21/traces/previews/final__EPYC_9575F__glm-tp2-numa-node0.json" %}

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/final/EPYC_9575F/glm-tp2-staging-workers-04.pftrace" id="epyc-workers-04" title="EPYC: four copying workers" preview="/assets/images/posts/2026-09-21/traces/previews/final__EPYC_9575F__glm-tp2-staging-workers-04.json" %}

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/final/EPYC_9575F/glm-tp2-numa-split-workers-04.pftrace" id="epyc-numa-split" title="EPYC: split NUMA nodes" preview="/assets/images/posts/2026-09-21/traces/previews/final__EPYC_9575F__glm-tp2-numa-split-workers-04.json" %}

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/final/EPYC_9575F/glm-tp2-direct-pinned-two-mappers-8gib.pftrace" id="epyc-direct-pinned" title="EPYC: direct pinned copy" preview="/assets/images/posts/2026-09-21/traces/previews/final__EPYC_9575F__glm-tp2-direct-pinned-two-mappers-8gib.json" %}

</details>

Although we get 4x, we can see why we get ~3x because copies are faster on these chips:

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/charts/plot_host_copy_bandwidth.svg" width="100%" text="CPU-copy bandwidth using 2 MiB `memcpy` calls over 4 GB buffers. Both use 4 KiB pages, with buffers and workers on the same NUMA node. Higher is better." %}

When we run these, it makes it so that you have to configure the number of threads on the intel to be higher to achieve the same bandwidth. So the takeaway is that because hosts hardware perform differently, you have to tune the copy to be the most performant.

## To conclude

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/charts/plot_overview_full.svg" width="100%" text="Time reduction with optimizations, plus separate Blackwell, incremental, and zero-page experiments" %}

At this point, we've reached at least a 15x speedup, which is great. Each technique mostly builds on top of each other:

The cli optimization + transparent huge pages + preallocation + NUMA awareness are pretty generic optimizations that any application can use, resulting in a 2x speedup.

By digging into the cuda stack and changing the number of workers and staging buffers, we can achieve a greater speedup.

# Optimizations for sandboxes

{% include image.html path="/assets/images/posts/2026-09-21/graphs/gvisor/charts/plot_gvisor_overview_breakdown.svg" width="100%" text="Breakdown of gVisor checkpoint and restore time" %}

But checkpointing cuda applications from GPU memory is one slice of the bigger pie. The final goal is to serialize the entire application state to some medium. Typically a disk is preferred because it can store a whole lot more than CPU memory at significantly less cost.

So let's see how well the `cuda-checkpoint` optimizations play in these applications. We can use [gVisor](https://gvisor.dev/), a popular sandboxing tool built and maintained by google. Modal uses gVisor's `runsc` runtime for container isolation and memory snapshots<span class="sidenote-ref"></span><span class="sidenote">[Modal: Memory snapshots with gVisor](https://modal.com/blog/mem-snapshots)<br>
[Modal: GPU memory snapshots](https://modal.com/blog/gpu-mem-snapshots)</span>.

In the following sections, I'll compare runnning gVisor running `cuda-checkpoint` with different flags used by gVisor with the goal in mind to minimize the CPU bottlenecks as much possible so we can see the `cuda-checkpoint` optimizations shine. We ran with commit `309599c1ec020ad52c82b7b6657acba73888e367`.

### Where gVisor spends the time

Let's start with stock gVisor running the same GLM workload. I'll ask the same question again: where does the time go?

`cuda-checkpoint` leaves the GPU checkpoint in host memory. gVisor then pauses the sandbox and saves its memory and kernel state. Then it serializes checkpoints as images on disk.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/gvisor/architecture/gv-stock-checkpoint-flow.svg" width="80%" alt="Stock gVisor checkpoint copies GPU state to host memory, pauses the sandbox, and saves its memory and kernel state to NVMe. Restore loads the sandbox, restores GPU state, and resumes the application." text="Stock gVisor checkpoint and restore. The GPU checkpoint is saved in host memory before gVisor writes the sandbox state to NVMe." %}

Here's a breakdown of that timeline at a high level:

{% include image.html path="/assets/images/posts/2026-09-21/graphs/gvisor/charts/plot_gvisor_stock_timeline.svg" width="100%" text="Where stock gVisor spends the time checkpointing and restoring GLM on NVMe" %}

Serialiazing the GPU memory takes ~64s, but then serializing all of the CPU memory takes 228s (almost 3x more)? Almost all of that second part is spent saving about ~333GB of memory pages.

Unexpectedly restore does the reverse. Load the pages from the file, restore the GPU state, then let the application run. Loading pages takes less time at 42 seconds and GPU restore takes 27 seconds<span class="sidenote-ref"></span><span class="sidenote">You might wonder why restore is quite fast? Looks like the NUMA memory placement was correct for restore</span>.

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/gvisor/glm/nvme/stock.pftrace" id="gvisor-glm-stock" title="Stock gVisor on NVMe" preview="/assets/images/posts/2026-09-21/traces/previews/blog__gvisor__glm__nvme__stock.json" %}

So making CUDA faster can help, but it won't remove those 228 seconds. We need to look at how gVisor saves memory too.

## Seeing cuda-checkpoint optimizations in action

First, let's use our optimized CUDA path without changing gVisor's page writer.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/gvisor/architecture/gv-cuda-checkpoint.svg" width="80%" text="Use the optimized CUDA path inside gVisor" %}

The gpu checkpointing/restore swap in reduces the end to end time by almost 100s, which is pretty neat.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/gvisor/charts/plot_gvisor_cuda_comparison.svg" width="100%" text="Stock and optimized CUDA checkpointing inside gVisor" %}

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/gvisor/glm/nvme/stock-cuda-slots16.pftrace" id="gvisor-glm-cuda" title="Stock gVisor with optimized CUDA" preview="/assets/images/posts/2026-09-21/traces/previews/blog__gvisor__glm__nvme__stock-cuda-slots16.json" %}

### Getting the checkpoint onto storage faster

Most of the time is spent in gVisor trying to serialize the pages to disk. Why is this so slow? It's because the gVisor sends 256 KiB writes through one serial worker. We can skip this with `--direct` flag turned on.

By opening the pages file with `O_DIRECT` to bypass the page cache. gVisor then uses Linux asynchronous I/O, allowing several requests to be in flight instead of finishing one buffered write at a time, which it configures to have a depth of 128 instead of 1. We can also make the buffers bigger.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/gvisor/architecture/gv-writer.svg" width="80%" text="Buffered writes, direct I/O, and larger requests to the NVMe array" %}

First, let's measure file I/O by itself. This fio test uses one job and moves 16 GiB per pass. Writes use 256 KiB requests; reads use 4 MiB requests<span class="sidenote-ref"></span><span class="sidenote">The requested I/O depth is 128 for writes and 12 for reads. These match stock gVisor's request sizes, but fio's queueing differs from gVisor's workers. The runs are short and may use backend caches, so they do not establish sustained storage limits. [Measurements and achieved I/O depth](/assets/images/posts/2026-09-21/traces/blog/gvisor/microbenchmarks/fio-nvme-fuse-gvisor-default-256kib-writes-4mib-reads.json).</span>.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/gvisor/charts/plot_gvisor_fio_defaults_nvme.svg" width="100%" text="NVMe file-I/O microbenchmark with stock gVisor request sizes. Write bandwidth includes the final sync; read bandwidth uses the I/O interval. Higher is better." %}

This change with larger requests decreases the time taken by almost 90%, cutting down the time spent copying CPU memory from about 228 seconds to 23 seconds<span class="sidenote-ref"></span><span class="sidenote">You might wonder why Stock + direct I/O reduces CUDA checkpoint. Again NUMA allocated memory correctly this time on the right node</span>. Running with optimized `cuda-checkpoint` reduces the time by 50%.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/gvisor/charts/plot_gvisor_io_comparison.svg" width="100%" text="Checkpoint and restore with direct I/O on NVMe" %}

Here's the perfetto traces for this

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/gvisor/glm/nvme/stock-odirect.pftrace" id="gvisor-glm-direct-io" title="gVisor with direct I/O" preview="/assets/images/posts/2026-09-21/traces/previews/blog__gvisor__glm__nvme__stock-odirect.json" %}

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/gvisor/glm/nvme/stock-odirect-cuda-slots16.pftrace" id="gvisor-glm-direct-io-cuda" title="Direct I/O with optimized CUDA" preview="/assets/images/posts/2026-09-21/traces/previews/blog__gvisor__glm__nvme__stock-odirect-cuda-slots16.json" %}

### Parallel CPU/GPU streams

We are still waiting for CUDA to finish before starting most of the page writes. Can we use that time to write pages we already have?

{% include image.html path="/assets/images/posts/2026-09-21/graphs/gvisor/architecture/gv-rule.svg" width="80%" text="Start writing pages while CUDA checkpointing is running" %}

An optimization that be done is to write the gvisor memory and cuda-checkpoint both to disk as images at the same time<span class="sidenote-ref"></span><span class="sidenote">gVisor has different on disk images for the pages and the gpu checkpoint, which makes this even more promising</span>. However one problem is that the cuda-checkpoint pages and cuda state won't be synchronized with the rest of the process. How can we fix this? 

We record a hash when we copy the bytes, then hash the same memory again after CUDA finishes and the sandbox is paused. If the hashes match, we keep the data we've already written. If they differ, we know that the contents has changed and can save the updated contents. We still have to read the every piece of memory again, but we don't have to write every page again to disk. This optimization is not a flag in gVisor.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/gvisor/architecture/gv-stream.svg" width="80%" text="Copy and hash pages early, then check them again at the pause" %}

Here is what that overlap looks like in the trace:

{% include image.html path="/assets/images/posts/2026-09-21/graphs/gvisor/charts/plot_gvisor_stream_timeline.svg" width="100%" text="Page saving overlaps CUDA checkpointing" %}

While the gpu checkpointing is running, gVisor starts checkpointing the process at the same time. The GPU checkpoint finishes at 14.4s, so it rechecks the hashes and then serailizes any difference to disk, which would be in this case, the cuda-checkpoint image and and cuda context state.

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/gvisor/glm/nvme/stream-odirect-32mib-cuda-slots16.pftrace" id="gvisor-glm-stream" title="Streaming checkpoint with optimized CUDA" preview="/assets/images/posts/2026-09-21/traces/previews/blog__gvisor__glm__nvme__stream-odirect-32mib-cuda-slots16.json" %}

### Starting GPU restore before all pages arrive

Restore has a similar wait. The stock path loads the memory pages, then starts CUDA restore. It can instead load pages in the background and start CUDA restore earlier, waiting when it needs a page that hasn't arrived yet. This is enabled by setting `--background`

{% include image.html path="/assets/images/posts/2026-09-21/graphs/gvisor/architecture/gv-restore-background.svg" width="80%" alt="Before: gVisor loads every host page, then starts CUDA restore. After: loading overlaps CUDA restore. A red CPU page fault returns to the loader, and the access waits until the requested page arrives." text="Load all host pages first, or start CUDA restore while pages load" %}

After gVisor restores the process state and memory mappings, it can start CUDA restore while host pages continue loading. If restore needs memory that has not arrived, gVisor blocks that access until the saved data is available<span class="sidenote-ref"></span><span class="sidenote">See <a href="https://github.com/google/gvisor/blob/309599c1ec020ad52c82b7b6657acba73888e367/pkg/sentry/mm/syscalls.go#L38-L77"><code>HandleUserFault</code> in <code>syscalls.go</code></a>.</span>. CUDA restore then rebuilds the GPU resources from those bytes.

This makes no difference in speeding up the host pages, but allows `cuda-checkpoint` to work while the host pages are being loaded. 

{% include image.html path="/assets/images/posts/2026-09-21/graphs/gvisor/charts/plot_gvisor_restore_overlap.svg" width="100%" text="Overlap loading pages with CUDA restore" %}

CUDA restore itself seems to get slower: about 21 seconds instead of 11 seconds. But that's because it's waiting for the pages to load in from gVisor. Time reduces from 28.5s to 21.5, a nice 7 seconds in reduction.

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/gvisor/glm/nvme/stream-odirect-32mib-background-cuda-slots16.pftrace" id="gvisor-glm-background" title="Streaming checkpoint with background restore" preview="/assets/images/posts/2026-09-21/traces/previews/blog__gvisor__glm__nvme__stream-odirect-32mib-background-cuda-slots16.json" %}

### Putting the changes together

For GLM on NVMe, we brought checkpoint time from 296 seconds to about 20 seconds, roughly 15× faster.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/gvisor/charts/plot_gvisor_results.svg" width="100%" text="Checkpoint and restore with the gVisor changes on NVMe" %}

## What changes on an object store vs running on NVMe?

These results use local NVMe. What if the checkpoint file is on something like FUSE on S3?

{% include image.html path="/assets/images/posts/2026-09-21/graphs/gvisor/architecture/gv-fuse.svg" width="80%" text="Local NVMe and the FUSE storage path" %}

Repeating the same fio test on FUSE gives a different result: direct I/O lowers both write and read bandwidth in these runs.

The same choices don't work as well here.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/gvisor/charts/plot_gvisor_fuse_comparison.svg" width="100%" text="Checkpoint and restore on FUSE" %}

The reason is that there is contention in the fuse layer. The seq write speed caps out at 1.5 GB/s already.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/gvisor/charts/plot_gvisor_fio_comparison.svg" width="100%" text="Buffered and direct I/O on NVMe and FUSE" %}

<details markdown="1" style="margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">FUSE traces and storage microbenchmarks</summary>

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/gvisor/glm/fuse/stock.pftrace" id="gvisor-fuse-stock" title="Stock gVisor on FUSE" preview="/assets/images/posts/2026-09-21/traces/previews/blog__gvisor__glm__fuse__stock.json" %}

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/gvisor/glm/fuse/stream-buffered256-cuda-slots16.pftrace" id="gvisor-fuse-buffered" title="Buffered streaming on FUSE" preview="/assets/images/posts/2026-09-21/traces/previews/blog__gvisor__glm__fuse__stream-buffered256-cuda-slots16.json" %}

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/gvisor/glm/fuse/stream-odirect-32mib-background-cuda-slots16.pftrace" id="gvisor-fuse-direct" title="Direct streaming and background restore on FUSE" preview="/assets/images/posts/2026-09-21/traces/previews/blog__gvisor__glm__fuse__stream-odirect-32mib-background-cuda-slots16.json" %}

</details>

## Does this help a smaller model?

GLM5.3 is a fairly large model at doesn't fit on a single GPU. Let's try Qwen3-4B-FP8 on one GPU (~5GB vs ~344GB).

{% include image.html path="/assets/images/posts/2026-09-21/graphs/gvisor/charts/plot_gvisor_qwen_comparison.svg" width="100%" text="Checkpoint and restore of Qwen on NVMe" %}

Stock takes 17.3 seconds for checkpoint and restore. Direct streaming with optimized CUDA takes 8.0 seconds, about 2.2× faster. Even with such a small model, we still can see a 2x improvement.

<details markdown="1" style="margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">Qwen traces</summary>

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/gvisor/qwen/nvme/stock.pftrace" id="gvisor-qwen-stock" title="Stock Qwen checkpoint and restore" preview="/assets/images/posts/2026-09-21/traces/previews/blog__gvisor__qwen__nvme__stock.json" %}

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/gvisor/qwen/nvme/stream-buffered256.pftrace" id="gvisor-qwen-buffered" title="Qwen with buffered streaming" preview="/assets/images/posts/2026-09-21/traces/previews/blog__gvisor__qwen__nvme__stream-buffered256.json" %}

{% include perfetto_trace_card.html path="/assets/images/posts/2026-09-21/traces/blog/gvisor/qwen/nvme/stream-odirect-32mib-cuda-slots16.pftrace" id="gvisor-qwen-direct" title="Qwen with direct streaming and optimized CUDA" preview="/assets/images/posts/2026-09-21/traces/previews/blog__gvisor__qwen__nvme__stream-odirect-32mib-cuda-slots16.json" %}

</details>

## Other tidbits

I see that gVisor also calls `cuda-checkpoint` on contexts with very small memory (like a vLLM monitoring processed that forked from the original). There could be ways to optimize for this if cuda isn't being used in the process.

I think gVisor could greatly benefit from hardware decompression on blackwell. Even for weights, a ~1.2x speedup while compressing 1.3x for model weights is pretty good. When there's a lull in activity, a couple of cores can be used for compressing the gpu checkpoint image.

# Future thoughts

## New kid on the block: custom storage checkpointing

CUDA 13.4 added a custom storage api to the checkpoint API that allows skipping the host buffer entirely<span class="sidenote-ref"></span><span class="sidenote">
[CUDA 13.4 release notes](https://docs.nvidia.com/cuda/archive/13.4.1/pdf/CUDA_Toolkit_Release_Notes.pdf): cuda-checkpoint can now write checkpoint state to persistent storage instead of retaining it only in process memory<br>
[CUDA Checkpointing API reference](https://docs.nvidia.com/cuda/cuda-driver-api/cuda_driver_api/group__CUDA__CHECKPOINT.html)
</span>. Instead of the driver copying VRAM into its own staging buffers, it hands us a device pointer per GPU and lets us decide where the bytes go.

```c
CUresult do_checkpoint(int pid, void **dst /* one host buffer per GPU */)
{
    cuInit(0);

    CUcheckpointLockArgs lock = {0};
    lock.timeoutMs = 30000;
    CUresult rc = cuCheckpointProcessLock(pid, &lock);
    if (rc != CUDA_SUCCESS) return rc;

    // Ask the driver to map the target's VRAM instead of copying it to host
    CUcheckpointCustomStorageInfo *info = NULL;
    CUcheckpointCheckpointArgs ckpt = {0};
    ckpt.customStorageInfo_out = &info;
    rc = cuCheckpointProcessCheckpoint(pid, &ckpt);

    if (rc == CUDA_SUCCESS) {
        // One contiguous mapping per GPU. Copy it wherever we want.
        for (unsigned i = 0; i < info->deviceCount; i++) {
            CUcheckpointCustomStoragePerDeviceData *d = &info->perDeviceData[i];
            cuMemcpyDtoHAsync(dst[i], d->devPtr, d->size, d->stream);
        }
        // Driver syncs every stream above, then unmaps and releases VRAM
        rc = cuCheckpointOperationComplete(info->handle);
    }

    CUcheckpointUnlockArgs unlock = {0};
    cuCheckpointProcessUnlock(pid, &unlock);
    return rc;
}
```

The flow is the same lock, checkpoint, unlock as before, with two differences. Checkpointing takes a `customStorageInfo_out` pointer, and we have to call `cuCheckpointOperationComplete` once our copies are enqueued<span class="sidenote-ref"></span><span class="sidenote">[cuCheckpointOperationComplete](https://docs.nvidia.com/cuda/cuda-driver-api/cuda_driver_api/group__CUDA__CHECKPOINT.html): synchronizes the returned streams, then unmaps the GPU memory and moves the target to `CU_PROCESS_STATE_CHECKPOINTED`</span>. Restore is symmetric: `cuCheckpointProcessRestore` takes the same output pointer, we copy our bytes back into the mapped device pointers, and complete the operation again.

You might wonder how a plain `cuMemcpyDtoHAsync` from our process work on another process's memory? Because the driver maps it into our address space for us as described from the docs<span class="sidenote-ref"></span><span class="sidenote">[cuCheckpointProcessCheckpoint](https://docs.nvidia.com/cuda/cuda-driver-api/cuda_driver_api/group__CUDA__CHECKPOINT.html), [CUcheckpointCustomStoragePerDeviceData](https://docs.nvidia.com/cuda/cuda-driver-api/cuda_driver_api/structCUcheckpointCustomStoragePerDeviceData.html)> all the GPU memory allocated by the process with `pid` will be mapped onto the calling process's GPUs so the application can copy the memory to custom storage</span>:

This gives us the previous section should capture similar bandwidth<span class="sidenote-ref"></span><span class="sidenote">Probably won't work out of box, but at least when I tried on a spare RTX3090, it had reached PCIE bandwidth calling `cuMemcpyDtoHAsync`. Also, why won't it work with older cuda versions? The kernel driver doesn't expose a clear way to map the same gpu virtual memory between two processes to the same cuda context</span>.

## Grace Hopper

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/architecture/15-grace-a.svg" width="100%" text="HGX B300 over PCIe versus GB300 over NVLink-C2C; nominal bandwidth per GPU, per direction" %}

Grace Hopper and Grace Blackwell use NVLink-C2C instead of PCIe for transfers between the GPU and its paired CPU’s memory. GH200 provides up to 450 GB/s per direction for one GPU. GB200 splits the same total bandwidth between two GPUs, giving each up to 225 GB/s per direction<span class="sidenote-ref"></span><span class="sidenote">
[NVIDIA: Grace Hopper architecture](https://developer.nvidia.com/blog/nvidia-grace-hopper-superchip-architecture-in-depth)<br>
[NVIDIA: GB200 bandwidth clarification](https://forums.developer.nvidia.com/t/nvidia-gb200-nvl72-delivers-trillion-parameter-llm-training-and-real-time-inference/286460/7)<br>
The advertised 900 GB/s includes both directions: 900 ÷ 2 = 450 GB/s for GH200; 900 ÷ 2 ÷ 2 GPUs = 225 GB/s per GPU for GB200.
</span>.

We should expect much higher bandwidth bottlenecks from staging buffers and should much prefer direct copy instead. Many more cores are needed to reach the bandwidth.

## Batching setup and teartown commands

Since we know we're going to setup the state and all of the state for the GPU down, we can batch the commands into one syscall call to the kernel module instead of spreading it out.

{% include image.html path="/assets/images/posts/2026-09-21/graphs/cuda/architecture/batching-user-kernel-boundary.svg" width="80%" text="Send several operations in one kernel call" %}

## Serializing to other mediums

Other mediums will mostly be the bottleneck compared to PCIE (lower cost!). Could be HDDs, SSDs, Object Stores, memory pools, distributed filesystems. We should try to aim to parallelize the work of these devices to decrease latency

## Thinking about running these optimizations in production

Since we are focused on optimizing a single microbenchmark, some questions are left for systems that have multiple concurrent checkpointing and restores that could be happening at once. There could be a burst of requests and then a lull, for example.

### Preallocation optimization

I believe that it's pretty hard to predict the future (and especially if that future is very soon). If we preallocate memory for an image that in the future be stored or restored, how big should that allocation be?

The simplest way is to statically allocate a big pool of memory and use it for checkpointing.

Another hacky way is to throw all the metrics into a machine learning model and tell it to optimize for say checkpointing/restore hits with the mimimal amount of memory by observing a history of requests<span class="sidenote-ref"></span><span class="sidenote">Understability is a bit harder to get here</span>.

Or maybe just not preallocate at all. Or maybe preallocate only if memory limits never get hit with other workloads. Or maybe just isolate the machine to only allocate up to a certain amount using cgroups and you know that the rest of memory has to be used for checkpointing.

### NCCL and other state

NCCL and other custom protocols require serializaton as well, which `cuda-checkpoint` is unaware of. `cuda-checkpoint` only checkpoints at the awareness of a single GPU. Most systems running in data centers utilize more than a single GPU. 

### Priority

To achieve the lowest latency, the gpu sandbox should be checkpointed or restored immediately. But one could imagine a huge queue of sandboxes ready to be checkpointed or restored at any given moment. The GPU process might hold a huge amount of memory or very little. What does one decide to checkpoint? We know that the speed is bounded by PCIE, so that's the limit. But we could run the workload on any GPU. Perhaps there could be a scheduler that tries to maximize the PCIE bandwidth used while minimizing the contention between applications trying to checkpoint or restore.

# Acknowledgments

Thanks to [Chirag Shetty](https://www.chiragshetty.com/) and [Ayush Ranjan](https://ayushr.com/) for giving valuable feedback.

# Citation

To cite this article:

```
@article{zhu2026cudacheckpointing,
  title = {Making CUDA Checkpointing 15x and gVisor 2x Faster on a B300: A Worklog},
  author = {Zhu, Henry and Sathia, Vimarsh},
  journal = {maknee.github.io},
  year = {2026},
  month = {October},
  url = "https://maknee.github.io/blog/2026/Cuda-Checkpointing/"
}
```
