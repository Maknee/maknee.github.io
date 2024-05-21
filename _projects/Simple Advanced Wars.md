---
layout:     post
title:      Simple Advanced Wars
summary:    An Advanced Wars Java Clone made in one week
categories: Java
rank:       1
img:  "/assets/images/projects/Simple Advanced Wars/thumbnail.jpg"
tags:
 - project
---

{% include image.html path="/assets/images/projects/Simple Advanced Wars/thumbnail.jpg" width="100%" %}

Advanced wars was a game that brings back memories of childhood. It is a turned-based war game boy advance game where the objective is to capture another player's headquarters. 

Here is some gameplay if you have never seen the game before:

{% include youtube.html id="gj07BISWs0U" %}

## What I did

So, I took it on myself to write a basic copy of game in one week, which was an incredible learning experience (First big java project!)

Also, the clone is written in pure java using java swing. 

There were some parts I had to figure out since this was pure java (no external libraries). Rendering was basically layering images on top of each other. I don't even talk about how I managed to get basic movement animations/ranged attack missles to work.

Some screen shots:

{% include image.html path="/assets/images/projects/Simple Advanced Wars/Example.png" width="100%" %}
Selecting a location for an unit to move to
{% include image.html path="/assets/images/projects/Simple Advanced Wars/Movement.png" width="100%" %}
Purchasing an unit
{% include image.html path="/assets/images/projects/Simple Advanced Wars/Purchase.png" width="100%" %}


## Compiling / Running

```
cd SimpleAdvancedWarsJava
cd src
mv ../*.png .
mv ../LeaderBoard.txt .
javac *.java
java Game
```

[Github link](https://github.com/Maknee/SimpleAdvancedWarsJava)
