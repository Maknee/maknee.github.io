---
layout:     post
title:      Practical Reverse Engineering Sample D
date:       2019-02-28 00:00:01
summary:    Reverse Engineering Sample D
categories: reverse-engineering
thumbnail:  "/assets/images/posts/PracticalReverseEngineering/Samples/D/front.jpg"
comments:   true
tags:
 - windows
 - reverse-engineering
 - malware
---

## Overview
I will be reverse engineering Sample D from [Practical Reverse Engineering](https://www.amazon.com/Practical-Reverse-Engineering-Reversing-Obfuscation/dp/1118787315)

This includes answering questions about the sample from the book as well as looking into other parts of the sample (if found to be interesting)

You can grab the samples from [here](https://grsecurity.net/malware_research/)

## Taking a glance

The first thing I want to check if the sample if intended for x86 or x64 using PEbear.

![PE](/assets/images/posts/PracticalReverseEngineering/Samples/D/PEbear.png)

As shown, it is an x86 sample

---

Loading into IDA, there only 6 functions written by the author (excluding import calls), which is really nice (beginner kernel malware to start reverse engineering with)

![Function](/assets/images/posts/PracticalReverseEngineering/Samples/D/functions.png)

## Tackling the questions!

In the book on page 184, question 1 is as stated:

```M
(Sample D)
Analyze and explain what the function 0x10001277 does.
Where does the second argument come from and can it ever be invalid?

What do the functions at offset 0x100012B0 and 0x100012BC do?
```

## 0x10001277

Whole function in IDA:

![a](/assets/images/posts/PracticalReverseEngineering/Samples/D/sub_10001277_whole.png)

Let's start at the top:

![a](/assets/images/posts/PracticalReverseEngineering/Samples/D/sub_10001277_first.png)

This part can be broken down into just two checks for dst and src.

```
if(MmIsAddressValid(dst) && MmIsAddressValid(src)) {
    ...
}
```

Afterwards,

![a](/assets/images/posts/PracticalReverseEngineering/Samples/D/sub_10001277_second.png)

The third argument is count, which has to be positive and src is subtracted from dst to get the offset.

```
if(count > 0) {
    size_t offset = src - dst;
    ...
}
```

Lastly,

![a](/assets/images/posts/PracticalReverseEngineering/Samples/D/sub_10001277_third.png)

Use of `[ecx + eax]` is essentially an array index to a pointer and afterwards, it the value is copied to the src pointer at an index.

Basically, an inline memcpy is implemented here.

This is done until esi is zero. 

```
memcpy(src, dst, count);
```

Decompiled:

```
void sub_10001277(PVOID dst, PVOID src, size_t count)
{
    if(MmIsAddressValid(dst) && MmIsAddressValid(src) && count) {
        memcpy(src, dst, count);
    }
}
```

```M
Where does the second argument come from and can it ever be invalid?
```

Take a look at the xrefs:

![a](/assets/images/posts/PracticalReverseEngineering/Samples/D/sub_10001277_xref.png)

The first two xrefs:

![a](/assets/images/posts/PracticalReverseEngineering/Samples/D/sub_10001277_xref1.png)
![a](/assets/images/posts/PracticalReverseEngineering/Samples/D/sub_10001277_xref2.png)

These both reference `[edi + 0Ch]`. In the beginning of the function, IDA labels edi as `Irp`.

What is at the offset at [0Ch of Irp](http://terminus.rewolf.pl/terminus/structures/ntdll/_IRP_x86.html)? 



