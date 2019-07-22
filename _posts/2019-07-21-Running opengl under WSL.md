---
layout:     post
title:      Running opengl under WSL
date:       2019-07-21 06:01:00
summary:    Running opengl under WSL
categories: Opengl
thumbnail:  "/assets/images/posts/2019-07-21/icon.png"
tags:
 - C++
 - Opengl
 - WSL
---

<img src="/assets/images/posts/2019-07-21/icon.png" width="100%">

## Opengl and WSL

There is little information about opengl under wsl. The first post that comes up on google with a blog states that opengl doesn't function under WSL and he gave up.

https://bowenzhai.ca/2018/04/15/OpenGL-Development-on-WSL-From-Setting-Up-to-Giving-Up-And-What-I-Learned/

A response from the WSL repo states that it may/may not work

https://github.com/microsoft/WSL/issues/2855

However, advanced opengl apps can definitely run under WSL!

# Demo

<img align="center" src="/assets/images/posts/2019-07-21/running.gif" width="100%">

The demo can be found [here](https://github.com/Maknee/OpenglUnderWSL)

## Setup

[The demo includes scripts for installing the following](https://github.com/Maknee/OpenglUnderWSL)

Some dependencies to install

```
sudo apt install mesa-utils

sudo apt-get install x11-apps

sudo apt install clang

sudo apt-get install libglfw3

sudo apt-get install libglfw3-dev
```

On the desktop, install [MobaXterm](https://mobaxterm.mobatek.net/download-home-edition.html), which has a X server for displaying graphics from WSL

## Test

Run the following to see if it works:

`export DISPLAY=:0`

`xeyes`

Now compile your program with the flags

```
-lX11 -lGL `pkg-config --static --libs glfw3`
```

In your opengl code, DO NOT INITIALIZE THE CORE! Comment it out

`//glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);`

Now run your program including the environment variable to tell opengl to run with 3.3
`MESA_GL_VERSION_OVERRIDE=3.3`

For example,
`MESA_GL_VERSION_OVERRIDE=3.3 ./test_program`

Now you can run opengl applications under WSL! :)

Let me know if this works for you / or you encounter problems!
