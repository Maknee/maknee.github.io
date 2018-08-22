---
layout:     post
title:      Object Oriented C Library - Introduction
date:       2018-08-17 12:32:18
summary:    Object Oriented C Library
categories: C
thumbnail:  "/assets/images/posts/2018-08-17/thumbnail.jpg"
tags:
 - C
 - C++
 - Object Oriented C
---

## Ah... good ol C

<img src="/assets/images/posts/2018-08-17/c_programming.jpg" width="35%">

I have been always a big fan of C. 

It's:
1. Simple - All you need to really wrap your head around are pointers and memory!
2. Compact - The C standard library is tiny compared to the monster libraries that Java and C++ have.
3. Powerful - C is the high-level language that is closest to assembly. One can translate C to assembly just by looking at C and have an general idea of what is happening to memory.

C has been around for ages. It hasn't changed much, but it is still a popular language among the low-level programmers (ex. [kernel dev](https://cppdepend.com/blog/?p=898), [function/memory tools](https://github.com/rantoniello/valgrind), [Linus Torvald's rants](https://www.reddit.com/r/linusrants/))

## C the ugly side

However, there are a plethora of reasons as to why C is not an attractive modern language to work with.

<img src="https://media1.tenor.com/images/5578616247515b540d877db81818f009/tenor.gif?itemid=7866344" width="50%">

1. Memory management - Other languages like Java have a [garbage collector](https://en.wikipedia.org/wiki/Garbage_collection_(computer_science)), so one doesn't have to worry about managing memory 
2. Suitable standard library - C standard library. There are many gotchas in the standard library. There are many [deprecated functions](https://wiki.sei.cmu.edu/confluence/display/c/MSC24-C.+Do+not+use+deprecated+or+obsolescent+functions) in the standard library. There are many thread unsafe functions in the standard library. The standard library will make you [sad](https://youtu.be/8GxqvnQyaxs?t=23) sometimes. :(
3. Getting something done - C doesn't have [vectors](https://en.cppreference.com/w/cpp/container/vector). C doesn't have [maps](https://en.cppreference.com/w/cpp/container/map). C doesn't really even have proper [strings](https://symas.com/the-sad-state-of-c-strings/). C doesn't have anything really besides pointers and memory that the programmer has to figure out how to use. This makes developing something in a timely manner incredibly frustrating and difficult.

<img src="/assets/images/posts/2018-08-17/feelsbadman.png" width="30%">

## C++ like C?

Wait. There's still hope!

<img src="/assets/images/posts/2018-08-17/feelsgoodman.png" width="50%">
<span class="rainbow">Introducing [OOC](https://github.com/Maknee/OOC)! (Object oriented C library)</span> - [Github link](https://github.com/Maknee/OOC)

OOC is a library wrapper I wrote around a year ago. It is mainly influenced by C++ and has C++ like syntax.

[Here is a quick example of string splitting in OOC](https://github.com/Maknee/OOC/blob/master/examples/String-Parsing_Example/string_example.c):

{% highlight cpp %}
Vector(String) SplitByDelimiter(String str, String delimiter)
{
	//Create a vector containing all the strings
	Vector(String) directories = New(Vector(String));

	//Parse line 
	int start_index = 0;
	int index_of_slash = 0;

	//Find the index of the next occurence of "/"
	while ((index_of_slash = Call(str, find, delimiter, start_index)) != NPOS)
	{
		//Get the substring between the last occurence and next occurence of "/"
		String directory = Call(str, substring, start_index, index_of_slash);

		//Insert the substring into the vector
		MoveCall(directories, push_back, directory);

		//Update the index to one past the occurence of "/"
		start_index = index_of_slash + 1;
	}

	//There is still one substring after the last occurence of "/"
	String last_directory = Call(str, substring, start_index, index_of_slash);

	MoveCall(directories, push_back, last_directory);

	return directories;
}
{% endhighlight %}

[An example of string splitting in C++](https://github.com/Maknee/OOC/blob/master/examples/String-Parsing_Example/string_example.cpp):

{% highlight cpp %}
std::vector<std::string> SplitByDelimiter(std::string& str, std::string& delimiter)
{
	//Create a vector containing all the strings
	std::vector<std::string> directories;

	//Parse line 
	int start_index = 0;
	int index_of_slash = 0;

	//Find the index of the next occurence of "/"
	while ((index_of_slash = str.find(delimiter, start_index) != std::string::npos))
	{
		//Get the substring between the last occurence and next occurence of "/"
		std::string directory = str.substr(start_index, index_of_slash);

		//Insert the substring into the vector
		directories.push_back(std::move(directory));

		//Update the index to one past the occurence of "/"
		start_index = index_of_slash + 1;
	}

	//There is still one substring after the last occurence of "/"
	std::string directory = str.substr(start_index, index_of_slash);

	directories.push_back(std::move(directory));

	return directories;
}
{% endhighlight %}

As you can see, OOC's syntax is very similar C++'s syntax, which is pretty neat since OOC is implemented in just C.

## Breaking down the example

{% highlight cpp %}
Vector(String) SplitByDelimiter(String str, String delimiter)
{% endhighlight %}

Objects in OOC are pointers since references in C do not exist. By default, everything is passed by reference (pointers, cough, cough) in OOC. 

Therefore, `String` type here is actually a pointer to a string struct. `Vector(String)` as well is a pointer to a vector of string structs. 

{% highlight cpp %}
//Create a vector containing all the strings
Vector(String) directories = New(Vector(String));
{% endhighlight %}

Every object must be allocated with the `New` keyword. This is because C cannot automatically invoke the constructor when the object is declared unlike C++, which is allocated on the stack. 

{% highlight cpp %}
std::vector<std::string> directories; //automatic allocation on the stack!
{% endhighlight %}

In addition, as I mentioned in the previous paragraph, objects in OOC are actually pointers, so they work similar to having a pointer to a class in C++.

{% highlight cpp %}
//More like
std::vector<std::string>* directories = new std::vector<std::string>(); //allocating the vector in heap!
{% endhighlight %}

{% highlight cpp %}
//Find the index of the next occurence of "/"
while ((index_of_slash = Call(str, find, delimiter, start_index)) != NPOS)
{% endhighlight %}

You might have noticed that `Call(...)` is used to call the appropriate function unlike:

{% highlight cpp %}
while ((index_of_slash = str.find(delimiter, start_index) != std::string::npos))
{% endhighlight %}

`Call` is how one calls an class' function/method in OOC. `Call` requires at least two parameters to be passed, of which the first two are the `object variable`, which is `str` in the example and the second is the object's `function` that we wish to call, which is `find`. The rest are arguments to the function call. So, in the example above, we want `str` to call `find` the `delimiter` at offset `start_index`. 

Using `Call` definitely is harder to read than the C++ way, but the variable/function names are formatted in the correct order. On the technical side, the reason why `Call(...)` is necessary will be discussed in a future post.

Also, `NPOS` is used instead of `std::string::npos` as C doesn't have namespaces.

{% highlight cpp %}
//Get the substring between the last occurence and next occurence of "/"
String directory = Call(str, substring, start_index, index_of_slash);

//Insert the substring into the vector
MoveCall(directories, push_back, directory);
{% endhighlight %}

This is where it gets interesting. In C++11, [move semantics](https://stackoverflow.com/questions/3106110/what-are-move-semantics) became part of the C++ standard. To summarize, one could "move" the ownership of an object to another object or as some people describe it -- "[moves its guts to the new object](http://blogs.microsoft.co.il/alon/2013/04/03/introduction-to-c-11-series-part-9-r-value-l-value-move-semantics-and-perfect-forwarding/)".

<p>
<img src="https://media1.tenor.com/images/7f7394d62fa69a576f88dde163ae420e/tenor.gif?itemid=11687378" width="50%" alt>
<center><font size="-1"><em>Literally taking its guts.</em></font></center>
</p>

Basically, in the example above, `MoveCall(directories, push_back, directory);` would transfer move directory into directories vector, thus making directory invalid to use afterwards.

Example of what I mean by invalid usage after the item has been moved:

{% highlight cpp %}
//Insert the substring into the vector
MoveCall(directories, push_back, directory);

//Invalid code (directory is null, its contents were moved into directories)
//char* directory_c_str = Call(directory, c_str);

//Correct code (grab directory from within directories vector)
String directory = Call(directories, get, Call(directories, size) - 1); 
//Get the last element in directories 
{% endhighlight %}

The rest of the code should be pretty self explanatory :). Just look at the OOC and C++ example side by side.

## So, how does one copy then?

To, copy, you just use `Call` and not `MoveCall`.

{% highlight cpp %}
//Insert a copy of the substring into the vector
Call(directories, push_back, directory);
{% endhighlight %}

## How does heck does this even work?

<p>
<img src="https://media.giphy.com/media/12NUbkX6p4xOO4/giphy.gif" width="50%" alt>
<center><font size="-1"><em>Magic.</em></font></center>
</p>

Magic macros.

Did you just say [macros](https://stackoverflow.com/questions/14041453/why-are-preprocessor-macros-evil-and-what-are-the-alternatives), the awful, undebuggable, copy paste preprocessor magic?

<p>
<img src="https://media1.tenor.com/images/2d7df72b568551605943631988722703/tenor.gif?itemid=4905592" width="50%" alt>
<center><font size="-1"><em>Yes.</em></font></center>
</p>

In order to implement psuedo templating and have more usable and readable API, macros are necessary.

In the next few posts, we will dive into more examples and how OOC works internally.

---

## Extra tid bits

[Documentation](https://codedocs.xyz/Maknee/OOC/index.html)

[More examples](https://github.com/Maknee/OOC/blob/master/examples)

Current version is version 2 (OOC_V2) where the API has been simplified. If you see version 1 code (OOC_V1), the type is passed to every `Call`. By default, version 2 is enabled.

[Snaipe](https://github.com/Snaipe) implemented smart pointers in C with gcc extensions [libcsptr](https://github.com/Snaipe/libcsptr). This is really awesome!

Go check out his [post](https://snai.pe/c/c-smart-pointers/) about his project. This could be used to create a [RAII](https://en.wikipedia.org/wiki/Resource_acquisition_is_initialization)-like effect with OOC. 

---

## Object Oriented C Series:

[Introduction]({{ site.baseurl }}{% link _posts/2018-08-17-Object Oriented C Library - Introduction.md %})

