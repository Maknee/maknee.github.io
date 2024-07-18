---
layout:     post
title:      Review - Managing Memory Tiers with CXL in Virtualized Environments
date:       2024-06-26 00:00:00
summary:    Review - Managing Memory Tiers with CXL in Virtualized Environments
categories: Ramblings
# thumbnail:  "/assets/images/posts/2022-12-05/icon.png"
comments:   true
tags:
 - Rambling
---

# Review - Managing Memory Tiers with CXL in Virtualized Environments

## Overview

## Notes

DRAM DIMMS have physical limitation ~ so cloud providers are adding capacity memory to augment

Traditional ways scan access/PTE poison/instruction sampling
Azure has virtualized environments, so this has high overhead
Page size matters for performance.

Intel flat mode is a mixed mode, where dedicated pages are on local memory while rest are on local or CXL based on access.

Intel memory mode - memory not visible to system, so how to?

Source code: [memstrata](https://bitbucket.org/yuhong_zhong/memstrata/src)

Intel flat mode
- Hardware based
- Memory tiering

Memsrata
- Software based
- Page coloring
- ML estimator for overhead of access miss

DIMMs are biggest contributor to server cost
- 41% of carbon emmission at azure

Can use DDR4 instead of DDR5
- Reuse existing DIMMS




Cloud providers add CXL/

To this end,
cloud providers are increasingly adding a capacity memory
tier to augment regular locally-accessed DRAM, which we
refer to as the performance tier


The hypervisor/OS typically tracks memory hotness to promote hot
capacity-tier pages to the performance tier and demote cold
pages to the capacity tier


## Background

Hypervisor
- Track hotness to move pages between hot and cold tiers
- How?
    - scanning PTE access bits
    - temporarily unmapping entries to trigger minor page faults
    - Instruction sampling

Workload
- Uses [TPP, SOTA software tiering, 2023](https://arxiv.org/pdf/2206.02878)
- 7.5GB DRAM
- 2.5GB Second tier
- YCSB A on FASTER kv store (taking 8.3GB, so cannot fit all in DRAM)
    - Result
        - Devotes entire core to tracking accesses
            - Scanning bits in kswapd, so to demote cold pages

{% include image.html path="/assets/images/ramblings/2024-07-17/fig1.png" width="75%" %}

Interesting, you can see the commonly accessed in the the fresh VM. Randomized, you can't tell and warm, you can't tell either what's hot

Problems
- Spatial locality disappears with free page randomization and a hot vm.
    - free page randomization is another layer of indirection

{% include image.html path="/assets/images/ramblings/2024-07-17/fig2.png" width="75%" %}

4KB vs 2MB shows that for 100% DRAM, 2MB is better, but for 25% DRAM with SW, it's faster for 4KB and for hardware 2MB is only a bit faster.

## 3.1 Intel Flat Memory Mode

Data placement is implemented in the memory controller.
Advantages
- 1:1 ratio of placement on DRAM/CXL, basically 50/50
- Physical memory of DRAM and CXL is shown to CPU as separate, and data is not replicated on both
- Direct mapped, both CXL and dram are mapped to same address
- Mixed mode can expose memory as second NUMA node
- Physical memory is tied to either DRAM or CXL

{% include image.html path="/assets/images/ramblings/2024-07-17/fig3.png" width="75%" %}

Hardware-Tiered is very similar to how memory mode works for optane, but a bit more. The memory can be either in CXL/Local, but not both, and it's modulo. I wonder if it's hot access, to be able to space it out a bit more. (Change page allocator to space out hotneess)
Local memory mode is basically the other mode for optane. User manages memory.

{% include image.html path="/assets/images/ramblings/2024-07-17/fig4.png" width="75%" %}

Interesting, basically the DRAM is acting as a cache, but combines the total memory.

## 3.2 Application Performance

Lots of workloads!
- Web (DaCap, DeathStarBench)
- Database (Silo, PostgreSQL)
- Machine Learning (DLRM)
- Key value (FASTER, Redis, memcached)
- Big data (HiBench)
- Graph processing (GAP)
- Scientific computing (Spec CPU)

Configurations
- 2, 4, 8, 16, 32, 64GB
- Memory settings
    - DRAM only
    - CXL only
    - Hardware tiered only
    - Mixed mode (33% local, 67% hardware)

{% include image.html path="/assets/images/ramblings/2024-07-17/fig5.png" width="75%" %}

Wow what a big graph. bigger is worse. Compared to local memory. Seems like hardware and mixed workloads match local dram! for the most part. 
Workloads that don't work well(?), I wonder why. 5%-10% worse around
- Database
- Key value (Ranges from 5% to 20%.)
    - faster_uniform_ycsb_a and faster_uniform_ycsb_f, uniform destroys caching, maybe writes conflict?
- Machine learing
    - dlrm_rm2_1_low, not sure what's going here..., sparse indices it seems (uniform) that destroy caching
- Graph processing
    - sparsity destroys caching
- Scientific computing
    - Wow, fotonik3d_s is up to 50%. Not sure why?
Besides the workloads that don't work well, the general guide is that it works well
- faster_uniform_ycsb_c is better (but it's uniform, huh...), but it's only reads
- Hardware tiering only
    - 73% workloads < 5% slowdown
    - 86% workloads < 10% slowdown
- Mixed
    - 82% < 5%
    - 95% < 10%

But, also, the mixed mode works really well. Prevents conflicts on local DRAM.

## 3.3 Noisy Neighbors

New workload with noisness
- Another VM running memory Latency Checker
    - Scans memory in busy loop
    - Very memory intensive

Experiments
- Isolated
    - Conflicitng pages to same VM
    - Each page is only to same VM
- Conflicting
    - Conflicting pages to different VMs
    - Pages are shared across VMs (I assume to be typical)

{% include image.html path="/assets/images/ramblings/2024-07-17/fig6.png" width="75%" %}

This is p95 latency. redis_ycsb_a is really bad (480%).  What is p50? Still good with 73% < 10% slowdown.

{% include image.html path="/assets/images/ramblings/2024-07-17/fig7.png" width="75%" %}

LLC is last level cache.
LLC Can be configured in two ways
- Shared across VMs
- Partitioned evenly across VMs
Local Mem
- Isolated
    - Conflicting pages to same VM
    - Each page is only to same VM
- Conflicting
    - Conflicting pages to different VMs
    - Pages are shared across VMs (I assume to be typical)

Best perf is either "Partitioned LLC, local mem isolated", or "Shared LLC, local mem isolated" For the most part, mem conflicting impacts perf and partitioning impacts perf (to less extent). So go with shared llc and mem isolated. Why shared LLC, I wonder? I assume partitioned since isolated mem performs better.

## Memstrata

### Background
Page Coloring
- Conflicting pages are put to the same VM
Allocates dedicated local pages to reduce outliers memory miss
- Many workloads exhibit slowdown without any dedicated memory
Problems
- The hardware manages performance counters, hypervisor only has global miss rate
Solution
- A estimator for miss rate per VM
Details
- Partition local memory pages across different VMs to avoid inter VM conflicts, color these as diffrent
- Isolate pages to only the same VM, no inter VM channels

{% include image.html path="/assets/images/ramblings/2024-07-17/fig8.png" width="75%" %}

Interesting migration technique, basically the tiered pages causing conflicts for outliers can be moved to dedicated pages. I wonder how they implement the model in the kernel.

## 4.2 Identifying Outliers

MPKI
- Measures local memory misses per thousand instruction
No instruction to track per core misses
- Could transfer data from MC to hypervisor?

{% include image.html path="/assets/images/ramblings/2024-07-17/fig9.png" width="75%" %}

This is used for model is estimate the miss rate. 
Actual MPKI = (local memory misses / number of instructions executed) * 1000
Esimate miss ratio = (L3 miss latency vs local memory miss ratio fit)
Esimate MKPI = (stimate miss ratio * main memory request / instruction count) * 1000

Very cool usage of linear model to workaround local memory misses using L3 miss latency.

Wait, they use an online random forest binary classifier to check if VM will experience 5% slowdown.

It takes in
- esimate MPKI
- L3 miss latency
- L2 miss latency
- data TLB miss latency
- L2 MPKI

88% acc on validation.
only using PMPKI only get 63% 

## 4.3 dynamic page allocator

Given the model detects outlier VMs, how does it migrate?
Runs model for 10 seconds.

{% include image.html path="/assets/images/ramblings/2024-07-17/list1.png" width="75%" %}

Steps
- Sort VMs based on their slowness and average of local DRAM misses
- Higher slowdown number, will need to be moved
- page allocate selects a given number of dedicated pages from VM 1 to put into VM 2 (stepRatio being 10% by default)
- Maybe use DAMON, low overhead memory access tracking subsystem to track cold and hot pages, but it's overhead is too much (CPU cycles), so intead just move dedicated local pages anyways even if it's hot or cold

## 6 Evaluation

Questions
1. How does Intel® Flat Memory Mode compare to softwaremanaged tiering? (§6.1)
2. Can Memstrata improve the performance of outliers without impacting other applications? (§6.1)
3. How does dedicated memory page allocation affect application performance? (§6.2)
4. Is Memstrata sensitive to its parameters?

Setup
- 128GB DDR5 local
- 128GB DDR5 CXL

- HW-Tiered + Memstrata = 33% local, 67% hardware

{% include image.html path="/assets/images/ramblings/2024-07-17/fig10.png" width="75%" %}

Real workloads - 188 workloads over 100,000VMs!

Graph is compare slowdown vs local.

TPP is existing software tiering approach.
HW-Tiered is only hardware
HW-Tiered+Memstrata is hardware + software

Wow pretty good for HW-Tiered + Memstra. Combines the best of both worlds?

Have to understand why TPP/HW-Tiered perform worse on other cases.

{% include image.html path="/assets/images/ramblings/2024-07-17/fig12.png" width="75%" %}

As web and data workloads are the dominant workload categories at Azure [98], we choose the following workload mixes to evaluate Memstrata:
1. Web-heavy: 4 web, 1 data, and 1 outlier.
2. Data-heavy: 1 web, 4 data, and 1 outlier.
3. Balanced: 2 web, 2 data, 1 others, and 1 outlier.

c is interesting configuration. It manages to eliminate overhead with 4outliers

Memstra is only 4% usage for core and mem usage is 110MB, which is like 100/1024 * 1024 * 1024 = < 0.001% of memory

{% include image.html path="/assets/images/ramblings/2024-07-17/fig13.png" width="75%" %}

Dynamic changes, it adapts

{% include image.html path="/assets/images/ramblings/2024-07-17/fig14.png" width="75%" %}

hot tracking is not better cause its overhead using DAMON

{% include image.html path="/assets/images/ramblings/2024-07-17/fig15.png" width="75%" %}

Visual of hotness vs dedicatede pages. It does not match.

Very interesting paper
- Presents a software + hardware combination for memory tiering unlike previous papers which tackle only either
    - Very detailed numbers for workloads
- Questions:
    - 4.3 For page migration, if we increase the % of pages moved, how does that impact performance? (default is 10%)
    - 6.2 Intel® Flat Memory Mode with other memory ratios. I wonder how this would perform? 1:2, 1:4? Probably only a bit more overhead.
    - 4.3 I think that page migration could be a bit more complex (instead of just moving random pages). Based on Fig 14. Perhaps use a combination of hot and random page migrations or train a model based on hot mitgrations to eliminate the overhead.

- General Question
    - CXL devices vary. They mention you could attach DDR4? How well does this system handle latency for CXL devices that are slower?
    - How does it compare to treating another machine as a memory pool instead (we do not have CXL devices and unsure how costly they are)? It's much slower (over network)
    - Wonder how different ratios of DRAM/CXL impacts performance (multiple CXL devices might pose a different challenge with utilizing each CXL's bandwidth per workload)

- Can you expose the perf counters on CXL to cpu? Like mem mapped or syscall


