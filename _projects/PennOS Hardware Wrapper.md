---
layout:     post
title:      PennOS Hardware Wrapper
summary:    Booting an OS course project on baremetal x86
categories: C
rank:       6
thumbnail:  "/assets/images/projects/PennOS Hardware Wrapper/thumbnail.jpg"
tags:
 - project
---

![Thumbnail](/assets/images/projects/PennOS Hardware Wrapper/thumbnail.jpg)

## OS Class

The [OS class](http://www.cis.upenn.edu/~boonloo/cis380-fa17/) at my university has assignments and projects that run as an application under linux, unlike [some OS classes in other universities that develop run on baremetal](https://ocw.mit.edu/courses/electrical-engineering-and-computer-science/6-828-operating-system-engineering-fall-2012/), which is immensely more difficult to debug. 

The class was difficult and I learned a lot about how unix worked (Shells, pipes, redirection, signals, ...) and OSes in general (virtual memory, scheduling, caching, threads, ...).

For the final project, the goal was to create a file system, scheduler and shell, which took a lot of effort and was an awesome learning experience.

<p>
<img src="https://media1.tenor.com/images/a7b78e862abbdd98be690e5bbb7b29c5/tenor.gif?itemid=11631902" width="50%" alt>
<center><font size="-1"><em>Still doesn't know how virtual memory magic works internally since we were working at an application level</em></font></center>
</p>

## So, what's wrong?

However, I wasn't satisfied with not learning the more hardware-y side of things. Abstraction of topics are nice, but, for me, I want to dive a bit deeper. I had only five days before the deadline.

Let's execute this bad boi on x86 baremetal.

{% include youtube.html id="QK-k52oNjvU" %}

## Wait, how?

I used [qmeu](https://www.qemu.org/), an open source machine emulator that could emulate an x86 machine to test/run my code and cross compliation tool chain to compile the code, so we didn't have to link with any libraries (that's why it's baremetal :))

Also used [GRUB](https://en.wikipedia.org/wiki/GNU_GRUB), so I didn't have to deal with nasty super specific hardware specifications and GRUB also gives a lot of information about the machine like the memory range.

To run on an actual machine, I used rufus to format my image, since I'm on windows, but you can format the usb on the linux cli and install it like any other OS.

## Please gimme details.

The final project had several dependencies. Remember booting on baremetal and linking with any libraries that is specific to the OS is a no-no.

<p>
<img src="/assets/images/projects/PennOS Hardware Wrapper/c-standard-library-functions
.jpg" width="50%" alt>
<center><font size="-1"><em>You're kidding that I can't even use the standard library...</em></font></center>
</p>

No... I'm not kidding. [GNU C Library](https://www.gnu.org/software/libc/) wraps around [system calls](https://en.wikipedia.org/wiki/System_call) that are specific to the kernel. 

<p>
<img src="https://media1.tenor.com/images/294523bd51e91be13033035775cd013d/tenor.gif?itemid=5890434" width="50%" alt>
<center><font size="-1"><em>C already has barely anything</em></font></center>
</p>

Basically, what I did was try to implement every function I used by myself. So, for example, printf, malloc, and other standard library functions had to be implemented.

[Github link](https://github.com/Maknee/PennOS-hardware-wrapper)
