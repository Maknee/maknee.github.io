---
layout:     post
title:      Reverse engineering an Android Game - Analyzing the Anti-Cheat - Part 1
date:       2018-08-05 12:32:18
summary:    Taking a look at android game's anti-cheat
categories: reverse-engineering
thumbnail:  "/assets/images/2018-08-05/game-image.jpg"
tags:
 - android
 - reverse-engineering
 - games
---

## Overview

I've recently been interested with mobile reverse engineering. It's something new and freshing for me. 

Today, we'll be looking at a recent popular mmorpg based game that is like its predecessor on PC. Like many mobile games, it includes auto-hunt and huge pay2win elements, but at least, you are given a opporunity to progress in the game without grinding through everything manually.

![Android game](/assets/images/2018-08-05/game-image.jpg)

## Unpacking the apk

The apk can be found online through many sites, the most popular being [APKPure](https://apkpure.com)

Once the apk has been downloaded, one can unpack the apk and generate a disassembly of java source by uploading the apk to [JavaDecompiler](http://www.javadecompilers.com/apk)

![java-decompiler](/assets/images/2018-08-05/java-decompiler.png)

The site uses [Jadx](https://github.com/skylot/jadx) to decompile the dex files into the source java files.

![java-decompiler-save](/assets/images/2018-08-05/java-decompiler-save.png)

Once it's done, you can click the save button to save the unpacked contents to desktop.

## Testing the game

If any process that attaches to the game or any cheat-related programs are launched, something similar to the following will appear:

![illegal](/assets/images/2018-08-05/illegal.png)

:(, I guess it's not that simple to crack

## Finding the target

Now, we to figure out where the anti-cheat is located.

What we can search for:
{:.listhead}

- kill (kills the process)
- process (kills the process)
- pid (find pid of process)
- ptrace (something to do with debugger)

After searching around with the individual strings and combining them, the magic string is `killprocess`

(I'm using sublime to search for strings and for syntax highlighting)

What we get:

![find-kill-process](/assets/images/2018-08-05/find-kill-process.png)

Clicking on the first entry:

![click-find-kill-process](/assets/images/2018-08-05/click-find-kill-process.png)

Multiple strings in this file indicates that this file loads/interfaces with the anticheat.

## Ending

Woot! Looks like we found the anticheat wrapper(ish) java class.

In the next part, we'll take a deeper dive into the anticheat and look at what the anticheat does to protect the game.

We'll use a combination of static and dynamic analysis tools like [IDA](https://www.hex-rays.com/products/ida/), [radare2](https://github.com/radare/radare2) and [frida](https://github.com/frida) to analyze our target.

[Part 2](https://google.com)

## Extra finds
There's a `float highSpenderProbability` that is stored in a class. All I can say is that is value is used to determine if the user is a [whale](https://www.reddit.com/r/gaming/comments/63lvak/what_is_a_whale/).

