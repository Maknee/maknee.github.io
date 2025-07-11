---
layout:     post
title:      An Intro to DeepSeek's Distributed File System
date:       2025-04-15 06:00:00
summary:    3FS
categories: 3FS
thumbnail:  "/assets/images/posts/2025-03-13/thumbnails/thumbnail-1.svg"
comments:   true
tags:
 - 3FS
jupyter:    true
mermaid:
    enabled: true
    zoomable: true
---

# Series

- [An Intro to DeepSeek's Distributed File System]({{ site.baseurl }}{% link _posts/2025-04-15-3FS-Performance-Journal-1.md %})
- [A Reality Check on DeepSeek's Distributed File System Benchmarks]({{ site.baseurl }}{% link _posts/2025-06-18-3FS-Performance-Journal-2.md %})

<!--
- [Theoretical Performance Limits of 3FS]({{ site.baseurl }}{% link _posts/2018-12-07-RTX-DXR Path Tracer Host.md %})
- [Benchmarking 3FS]({{ site.baseurl }}{% link _posts/2018-12-08-RTX-DXR Path Tracer HLSL.md %})
- [Analysis of 3FS Benchmarks]({{ site.baseurl }}{% link _posts/2018-12-08-RTX-DXR Path Tracer HLSL.md %})
- [Improving 3FS Performance]({{ site.baseurl }}{% link _posts/2018-12-08-RTX-DXR Path Tracer HLSL.md %})
-->

# What is 3FS?

3FS ([Fire-Flyer File System](https://github.com/deepseek-ai/3FS)<span class="sidenote-ref"></span><span class="sidenote">Geez, what a tongue twister</span>) is a distributed filesystem released by [DeepSeek](https://www.deepseek.com/) during their [open source release week](https://github.com/deepseek-ai/open-infra-index). This blog post will dive into what distributed file systems are and how 3FS operates, starting with some background.

## What is a distributed filesystem?

Distributed filesystems trick applications into thinking they're talking to a regular local filesystem. This abstraction is incredibly powerful: a file that's actually fragmented across 10 different machines appears as a simple file path like `/3fs/stage/notes.txt`

{% include image.html path="/assets/images/posts/2025-03-13/part1/local_distributed_fs.svg" width="120%" text="Using the distributed filesystem is no different than local filesystem" %}

In the image above, I create the same folder and file on a local and distributed filesystem by running `mkdir` and `cat`. The commands are exactly the same. With a distributed filesystem, all of those details are abstracted away from the user, who can simply work with the files without worrying about how many machines, network calls or disks are involved behind the scene.

## Why use a distributed filesystem?

Distributed filesystems provide two main advantages over local storage -- they can serve massive amounts of data (up to petabytes) and provide high throughput that exceed the capabilities of a single machine. They offer fault tolerance (the system keeps running if one machine goes down) and redundancy (if data gets corrupted on one node, other nodes have original copies).

Distributed filesystems are used in many practical applications: 

- Parallel processing frameworks ([HDFS](https://hadoop.apache.org/) supporting [Spark](https://www.databricks.com/blog/2014/01/21/spark-and-hadoop.html))
- ML training pipelines with [Dataloaders and checkpointing](https://github.com/stas00/ml-engineering/blob/master/storage/README.md)
- Internal large-scale code/data repositories supported by [Google's Colossus](https://cloud.google.com/blog/products/storage-data-transfer/a-peek-behind-colossus-googles-file-system)
- Industry applications like [Traveling](https://juicefs.com/en/blog/user-stories/juicefs-vs-cephfs-distributed-file-system-artificial-intelligence-storage)
- Photo storage is served by [Meta's Haystack](https://www.usenix.org/legacy/event/osdi10/tech/full_papers/Beaver.pdf)

# A deep dive into 3FS

So, how does 3FS work?

At its core, 3FS consists of four primary node types:

{% include image.html path="/assets/images/posts/2025-03-13/explain/overview.svg" width="110%" text="Components involved in 3FS" %}

The components serve distinct purposes:

1. **Meta** -- manage the metadata: file locations, properties, paths, etc.
2. **Mgmtd** -- management server controls the cluster configuration: where are other nodes, which nodes are alive, and replication factor
   - Think of it as a router that knows every node's address and can help nodes find each other<span class="sidenote-ref"></span><span class="sidenote">A similar analogy is the centralized server used in [NAT hole punching](https://en.wikipedia.org/wiki/Hole_punching_(networking))</span>.
3. **Storage** -- nodes that hold the actual file data on physical disks.
4. **Client** -- communicates with all other nodes to view and modify the filesystem:
   - ask Mgmtd to discover other nodes
   - ask Meta servers to perform file operations (open, stat, close, symlink)
   - transfer data with storage nodes

Now let's look at each component in greater detail.

## Mgmtd

{% include image.html path="/assets/images/posts/2025-03-13/explain/mgmtd_register.svg" width="110%" text="Mgmtd Registering" %}

Mgmtd tracks what nodes are running in the cluster. Storage and meta nodes register when they boot up, sending periodic heartbeats to confirm they're still alive. This gives a central view of the system -- one can immediately identify which nodes are down.

{% include image.html path="/assets/images/posts/2025-03-13/explain/mgmtd_request.svg" width="110%" text="Mgmtd Requests" %}

Nodes don't need to maintain connections with every other node in the network. Instead, they can discover nodes by querying the mgmtd node. While this adds an extra round trip when locating nodes, it can reduce complexity since node discovery isn't static.

{% include image.html path="/assets/images/posts/2025-03-13/explain/mgmtd_chain.svg" width="110%" text="Mgmtd Chains" %}

Also, Mgmtd maintains the configuration for different nodes operating within a distributed algorithm. In particular, replicated chains ([CRAQ](https://www.usenix.org/legacy/event/usenix09/tech/full_papers/terrace/terrace.pdf)<span class="sidenote-ref"></span><span class="sidenote">CRAQ is a pretty neat algorithm that achieves strong consistency with fault tolerance by treating nodes as a chain. I'll explain this in depth in another section.</span>) are established and its nodes are stored as configuration in mgmtd.

## Meta

{% include image.html path="/assets/images/posts/2025-03-13/explain/meta_overview.svg" width="140%" text="Meta overview" %}

The meta node is a bit more complex than mgmtd. Clients communicate with it via RPC calls. The meta server performs typical filesystem operations (open, create, stat, unlink) on the metastore. File metadata resides in inodes, storing properties like size, permissions, owner, and timestamps. DirEntry objects map paths to inodes, with multiple DirEntries possible for a single file (similar to symlinks). Both inodes and DirEntries are stored in FoundationDB<span class="sidenote-ref"></span><span class="sidenote">One might wonder what the keys to founationdb look like? Inode: "INOD + inode id, dir entry: "DENT" + nodeid + path</span> using transactions for idempotent operations. A session manager tracks open files, storing file sessions in FoundationDB. If clients disconnect without closing files, the session manager initiates file syncs. File deletion requests queue to a garbage collector, which removes data from storage nodes before deleting directory entries and inodes.

## Storage

{% include image.html path="/assets/images/posts/2025-03-13/explain/storage_overview.svg" width="160%" text="Storage overview" %}

The storage node's main function is manage data on physical storage by breaking it up into chunks:
- The Rust ChunkEngine<span class="sidenote-ref"></span><span class="sidenote">Why Rust? Well, there's a legacy chunk manager named `ChunkStore` that's written in C++. I don't see really why in rust, probably because it's interesting to work in and provides more safety guarantees</span> keeps track of blocks of disk storage.
    - Chunks represent a piece of physical disk and keeps track of its metadata (id, size, offset on disk, physical disk, checksums, versions, ...). This is the most primitive data structure that all other structures use to keep track of blocks of data.
    - The chunk engine doesn't allow users to interact with chunks directly since it would add complexity to using engine. The interface to the engine has operations which gives users a rigid and clear way to interact with the engine (lookup, allocation, commit, metadata...)
    - By default, all of this is stored in [LevelDB](https://github.com/google/leveldb) with a prefix byte repesenting the type of operation (querying the metadata) and the chunk id as the key. 
- There are different workers that uses the chunk engine to maintain the physical storage
    - The AllocateWorker allocates new chunks in the chunk engine
    - The PunchHoleWorker reclaims chunks if they're no longer used
    - The AioReadWorker processes reads requests to the chunks and queues reads in [io_uring](https://en.wikipedia.org/wiki/Io_uring) queue, submits and waits for completion<span class="sidenote-ref"></span><span class="sidenote">Initially, I was surprised. The chunk engine doesn't perform operations on the actual physical disk, it really only manages the metadata. One reason for this might be to keep the ChunkEngine implementation rather lean by having it only try to manage metadata.</span>.
- The storage node needs to know how to forward a write to the next target in a CRAQ chain<span class="sidenote-ref"></span><span class="sidenote">For now, just know that writes need to be forwarded to other nodes</span>
    - Targets consist of chunks (think of this as logical store containing different chunks)
    - A chain consists of multiple targets (typically spanning multiple nodes)
    - The storage node queries the mgmtd server for other nodes' chains and the corresponding targets (nodes) in that chain that a write needs to forward to.

## CRAQ

CRAQ ([Chain Replication with Apportioned Queries](https://www.usenix.org/legacy/event/usenix09/tech/full_papers/terrace/terrace.pdf)) is a protocol for achieving strong consistency with linearizability. It serves as the core mechanism to keep data chunks fault-tolerant. I'll explain how CRAQ works and then, show its implementation in 3FS.

{% include image.html path="/assets/images/posts/2025-03-13/craq/craq_write_dirty.svg" width="115%" text="Craq write propagation" %}

Writes begin at the head. In our example, we write `name=henry` to the system. As the write moves down the chain, each entry is marked as "dirty" with a version number. Dirty entries aren't safe to read. Once the write reaches the tail, it's committed and marked as "clean".

{% include image.html path="/assets/images/posts/2025-03-13/craq/craq_write_clean.svg" width="115%" text="Craq write commit" %}

Writes become clean as commit messages propagates backward from tail to head. Each node commits the entry and marks it clean.

{% include image.html path="/assets/images/posts/2025-03-13/craq/craq_read_clean.svg" width="115%" text="Craq clean read" %}

For reads, the process is straightforward: if an object is clean, it's immediately returned to the client.

{% include image.html path="/assets/images/posts/2025-03-13/craq/craq_read_dirty.svg" width="115%" text="Craq dirty read" %}

The challenge occurs with dirty objects. Each chain tracks both dirty and clean versions. Since the tail always contains the latest committed data, the replica queries the tail for the most recent committed object, ensuring strong consistency.

### CRAQ performance

CRAQ read and write performance varies by workload. Write throughput and latency are limited by the slowest node in the chain, as writes must process through each node sequentially. For example, in [zipfian](https://en.wikipedia.org/wiki/Zipf%27s_law) workloads (where frequently accessed data dominates), read performance suffers because objects may be dirty, forcing queries to the tail node. This creates a bottleneck as the tail must serve most of the read requests.

### How is CRAQ used in 3FS

{% include image.html path="/assets/images/posts/2025-03-13/craq/craq_stripe.svg" width="115%" text="Storage is striped and CRAQ runs ontop" %}

In this example, 5 nodes with 5 SSDs each form the cluster. Storage targets replicate to 3 nodes, designed to avoid overlap so that node failures don't affect overall throughput significantly<span class="sidenote-ref"></span><span class="sidenote">Consider an extreme scenario where all the chains are placed on nodes 1, 2, 3. If node 1 fails, the distributed system would serve lose 1/3 of the total throughput instead of 1/5 of total throughput shown in the above image. [3FS design notes](https://github.com/deepseek-ai/3FS/blob/ee9a5cee0a85c64f4797bf380257350ca1becd36/docs/design_notes.md) shows an example with a deeper explanation.</span>. CRAQ operates on top, managing head, middle, and tail nodes.

3FS defaults to strongly consistent reads. Writes flow from head to tail and back, with throughput limited by the slowest node and latency determined by the combined latency across all chain nodes.

{% include image.html path="/assets/images/posts/2025-03-13/papers/ionia-table-1.svg" width="100%" text="Table comparing different replication protocols" url_source="https://www.usenix.org/system/files/fast24-xu.pdf" url_text="Table 1 from Ionia paper" %}

As shown in the comparison table, in the common case, CRAQ delivers scalable, low-latency reads at the cost of high write latency compared to other protocols and systems.

# Other distributed filesystems

One might ask -- is this architecture different from other distributed filesystems? At a high level, the components are familiar -- some notion of client, metadata, storage, and management nodes appear in virtually every distributed system.

The difference lies in its real-world applicability and practical implementation:
- which workloads it excels at handling
- its tuning flexibility
- deployment simplicity
- throughput scaling capabilities
- maintaining latency within SLOs
- reliability

and its finer technical details that determines its usability:
- what bottlenecks are there
- how it manages bottlenecks
- its approach to locking (or absence thereof)
- the specific data structures employed
- the hardware the software was designed for
- what fault tolerant algorithm or erasure coding is used

# Rest of the blog series

With that in mind, I want to dive deep into analyzing the performance of this relatively new open-source distributed filesystem<span class="sidenote-ref"></span><span class="sidenote">Distributed filesystems come once in blue moon, taking [several years to develop](https://dl.acm.org/doi/10.1145/3341301.3359656)</span>. Current benchmarks are rather limited. There's no comparisons with single-node systems and other distributed filesystems, so it's difficult to gauge how well 3FS performs.

Some questions I want to explore:

- Do some of the DeepSeek's claims hold up, especially regarding [FUSE bottlenecks](https://github.com/deepseek-ai/3FS/blob/ee9a5cee0a85c64f4797bf380257350ca1becd36/docs/design_notes.md#limitations-of-fuse)?
- Can I reproduce their performance graphs in some way?
- In what scenario does the performance degrade?
- What are the system's bottlenecks (CPU/memory/disk/network)?
- In what types of workloads does the fileysystem excel at?
- How does it compare with other distributed filesystems?
- How does it address problems that existing systems face?
- Am I able to make any improvements to the system?

Throughout the rest of the series, I will be going through the process of making initial assumptions, testing them, and learning from discrepancies to develop a deeper understanding of how 3FS actually performs.

# More reading

Implementation details are documented in the [design notes](https://github.com/deepseek-ai/3FS/blob/ee9a5cee0a85c64f4797bf380257350ca1becd36/docs/design_notes.md).

Additional technical documentation regarding early implementation phases is available (in Chinese):

- [Intro](https://www.high-flyer.cn/blog/3fs/)
- [Async IO](https://www.high-flyer.cn/blog/3fs-1/)
- [RDMA Read](https://www.high-flyer.cn/blog/3fs-3/)
- [Network routing](https://www.high-flyer.cn/blog/3fs-3/)
- [Load balancing reads](https://www.high-flyer.cn/blog/3fs-4/)

The system architecture is partially documented in [the Fire-Flyer AI-HPC paper](https://arxiv.org/abs/2408.14158).

# Acknowledgments

Thanks to [Vimarsh Sathia](https://vimarsh.me/) for reviewing this post.
