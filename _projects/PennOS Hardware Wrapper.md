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

{% include image.html path="/assets/images/projects/PennOS Hardware Wrapper/thumbnail.jpg" width="100%" %}

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

To run on an actual machine, I used [rufus](https://rufus.akeo.ie/) to format my image, since I'm on windows, but you can format the usb on the linux cli and install it like any other OS.

## Please gimme details.

The final project had several dependencies. 

### Libraries

Remember booting on baremetal and linking with any libraries that is specific to the OS is a no-no.

<p>
<img src="/assets/images/projects/PennOS Hardware Wrapper/c-standard-library-functions
.jpg" width="50%" alt>
<center><font size="-1"><em>You're kidding that I can't even use the standard library...</em></font></center>
</p>

No... I'm not kidding. [GNU C Library](https://www.gnu.org/software/libc/) wraps around [system calls](https://en.wikipedia.org/wiki/System_call) that are specific to the kernel. 

<p>
<img src="https://media1.tenor.com/images/294523bd51e91be13033035775cd013d/tenor.gif?itemid=5890434" width="50%" alt>
<center><font size="-1"><em>Writing C in general</em></font></center>
</p>

Basically, what I did was try to implement every function I used by myself. So, for example, printf, malloc, and other standard library functions had to be implemented. (Very simple implementation)

### CPU specific stuff

[PIT](https://en.wikibooks.org/wiki/X86_Assembly/Programmable_Interval_Timer), [PIC](https://wiki.osdev.org/8259_PIC), [ISR](https://wiki.osdev.org/Interrupt_Service_Routines), memory...

Unfortunately, I won't be going into this much as it's going to make this post 10x longer, but it's a lot of CPU specific setup to get interrupts to work. 

But, here's the [x86 OS dev link](https://wiki.osdev.org/Main_Page) that provides a ton of information about everything OS dev related.

BTW, I only used physical memory and did not setup virtual memory.

<p>
<img src="https://media1.tenor.com/images/5deafc275f9f7e3c95a773d2e4aa625a/tenor.gif?itemid=4953511" width="50%" alt>
<center><font size="-1"><em>Virtual memory still is black magic.</em></font></center>
</p>


### Threading Library

Our "threading" (I guess you can call it that) library used for the project was a combination of [ucontext](http://pubs.opengroup.org/onlinepubs/7908799/xsh/ucontext.h.html), even though it is [deprecated](https://stackoverflow.com/questions/17768925/ucontext-in-linux) and the [alarm signal](https://www.gnu.org/software/libc/manual/html_node/Setting-an-Alarm.html).

ucontext is a [user level thread context](http://www.manpagez.com/man/3/ucontext/).

The alarm signal would be sent every x milliseconds and in the signal handler, ucontext would fetch the correct context (containing the saved registers, instruction being executed and flags) and go to that context. Think of this context as the very simplified version of the kernel thread structure like, for example, the [ETHREAD](https://docs.microsoft.com/en-us/windows-hardware/drivers/kernel/eprocess) structure in the windows kernel.

Here's a really detailed [explanation](https://anonymalias.github.io/2017/01/09/ucontext-theory/) with cool pictures and everything, albeit in chinese and explaining the x64 version.

It's actually quite awesome how it's implemented. 

I made my version a bit simplier [version](https://github.com/Maknee/PennOS-hardware-wrapper/blob/master/ucontext_stub.asm) (does not perserve signals, etc).

In order to create a context, one needs to store the contents of the current stack into a ucontext_t structure and allocate memory for the new stack. If this is confusing, I'll provide an example below and details about the ucontext_t structure.

Everything that is required for the simpliest ucontext_t structure ([help from glibc source](https://code.woboq.org/userspace/glibc/sysdeps/unix/sysv/linux/x86/sys/ucontext.h.html)):

[Source](https://github.com/Maknee/PennOS-hardware-wrapper/blob/master/ucontext.h)

{% highlight cpp %}
typedef struct cpu_registers
{
	uint32_t eax;
	uint32_t ebx;
	uint32_t ecx;
	uint32_t edx;
	uint32_t edi;
	uint32_t esi;
	uint32_t ebp;

	uint32_t esp;
	uint32_t ss;
	uint32_t ds;
	
	uint32_t eip;
	uint32_t eflags;
	uint32_t cs;
} cpu_registers;

typedef struct ucontext
{
	struct ucontext *uc_link;
	stack_t uc_stack;
	cpu_registers registers;
	sigset_t uc_sigmask;
} ucontext_t;

int getcontext(ucontext_t *ucp);
int setcontext(const ucontext_t *ucp);
void makecontext(ucontext_t *ucp, void (*func)(), int argc, ...);
int swapcontext(ucontext_t *oucp, const ucontext_t *ucp);
{% endhighlight %}


As you can see, it's mostly about containing the register values and the stack.

Example of making a context

{% highlight cpp %}
void do_something(int a)
{
	printf("%d\n", a);

}

...
	ucontext_t* uc; //make context pointer

	getcontext(uc); //get information about the current stack/registers

	uc->uc_stack.ss_sp = malloc(sizeof(4096)); //allocate a 4kb stack
	uc->uc_stack.ss_size = 4096; //size of stack
	uc->uc_stack.ss_flags = 0; //flags 

	makecontext(uc, &do_something, 1); //now change the context structure to point to do_something
	setcontext(uc); //now execute do_something
...
{% endhighlight %}


In the example above, we call `getcontext(...)` in order to allocate memory for the `ucontext_t` struct and store information such as the current register values into the structure. 

Then, we call `makecontext(...)` to setup a function call on the allocated stack to `do_something(...)`. 

`setcontext(...)` actually switches the context to the other context.

WARNING: x86 assembly below

<p>
<img src="https://media1.tenor.com/images/e1a1761d7520cef3712a7d3b1305e3b3/tenor.gif?itemid=9749377" width="50%" alt>
<center><font size="-1"><em>Don't worry, I'll summarize below.</em></font></center>
</p>


[Source](https://github.com/Maknee/PennOS-hardware-wrapper/blob/master/ucontext_stub.asm#L38)

```
global getcontext
getcontext:
	
	;get parameter (ucontext_t* ucp)
	mov eax, [esp + 4]
	
	;eax not preserved
	;save general purpose registers
	;mov [eax + ucontext_t.eax], 0
	mov [eax + ucontext_t.ebx], ebx
	mov [eax + ucontext_t.ecx], ecx
	mov [eax + ucontext_t.edx], edx
	mov [eax + ucontext_t.edi], edi
	mov [eax + ucontext_t.esi], esi
	mov [eax + ucontext_t.ebp], ebp
	
	...

	ret
```

To summarize, all this does is save the register values into the `cpu_registers` struct

---

Now for `makecontext(...)`

[Source](https://github.com/Maknee/PennOS-hardware-wrapper/blob/master/ucontext_stub.asm#L171)

```
global makecontext
makecontext:

	;get parameter (ucontext_t* ucp)
	mov eax, [esp + 4]
	
	;get parameter (void (*function)())
	mov ecx, [esp + 8]

	;store the function of what we want to run
	mov [eax + ucontext_t.eip], ecx

	;get parameter (argc)
	mov edx, [esp + 12]

	...

	;get each parameter and populate stack
	;jump if ecx == 0
	jecxz .done_args

.more_args:
	
	;get from rightmost to leftmost
	mov eax, [esp + ecx * 4 + 12]
	mov [edx + ecx * 4], eax
	
	dec ecx
	jnz .more_args

	...

	ret
```

To summarize again, `makecontext(...)` pushes everything on the stack, so it's ready to swap.

Here's the stack when makecontext is done. As you can see, it contains the parameters and return address. (The function address is stored in ucontext.eip)

```
;void makecontext(ucontext_t *ucp, void (*func)(), int argc, ...);
;https://code.woboq.org/userspace/glibc/sysdeps/unix/sysv/linux/i386/makecontext.S.html

;top of stack

;-------------
;ucontext_termination (return address)
;-------------
;parameters to func
;-------------
;termination function
;-------------
;uc_link
;-------------
```

`setcontext(...)` actually switches to the other context.

[Source](https://github.com/Maknee/PennOS-hardware-wrapper/blob/master/ucontext_stub.asm#L107)

```
global setcontext
setcontext:

	...

	;push return address context's eip
	mov ecx, [eax + ucontext_t.eip]
	push ecx
	
	mov ecx, [eax + ucontext_t.cs]
	;mov cs, cx ;doing so results in a general protection fault?
	
	;restore eflags
	mov ecx, [eax + ucontext_t.eflags]
	push ecx
	popf
	
	;eax not preserved
	;save general purpose registers
	;mov [eax + ucontext_t.eax], 0
	mov ebx, [eax + ucontext_t.ebx]
	mov ecx, [eax + ucontext_t.ecx]
	mov edx, [eax + ucontext_t.edx]
	mov edi, [eax + ucontext_t.edi]
	mov esi, [eax + ucontext_t.esi]
	mov ebp, [eax + ucontext_t.ebp]

	;return to the ucontext's eip we pushed earlier
	ret
```

To summarize again, it restores all the register values and uses a [push ret technique](https://stackoverflow.com/questions/30916768/differences-between-call-pushret-and-pushjump-in-assembly) to `push` the function address on the stack and then use the `ret` to return to the function address, which is pretty neat.

Here is the state of the stack before `ret` is called.

```
;-------------
;function to execute (from ucontext's eip, which is set by makecontext)
;------------- (assume everything down here is set from make context
;ucontext_termination (return address)
;-------------
;parameters to func
;-------------
;termination function
;-------------
;uc_link
;-------------
```

I learned a lot from doing this project on my own and it was pretty cool to see my own application run on a machine by itself! :)

[Github link](https://github.com/Maknee/PennOS-hardware-wrapper)
