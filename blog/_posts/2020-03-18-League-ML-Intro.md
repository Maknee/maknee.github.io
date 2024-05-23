---
layout:     post
title:      Machine Learning with League of Legends - Introduction
date:       2020-03-18 06:01:00
summary:    Background information for League of Legends
categories: Opengl
thumbnail: "/assets/images/posts/2021-09-05/icon.jpg"
comments:   true
tags:
 - Machine Learning
---

{% include image.html path="/assets/images/posts/2020-03-18/icon.jpg" width="100%" %}

## Links to series

- [Introduction]({{ site.baseurl }}{% link _posts/2020-03-18-League-ML-Intro.md %})
- [Minimap Detection]({{ site.baseurl }}{% link _posts/2021-09-05-League-ML-Minimap-Detection1.md %})
- [Minimap Detection v2]({{ site.baseurl }}{% link _posts/2021-09-06-League-ML-Minimap-Detection2.md %})

## Introduction

In recent years, machine learning, especially in the field of [reinforcement learning](), has made impressive feats in regards with games.

* In 2017, [AlphaGo](https://deepmind.com/research/case-studies/alphago-the-story-so-far) was an AI that was able to beat the world-class champion in the board game, [Go](). 
* In Janurary of 2019, [AlphaStar](https://deepmind.com/blog/article/alphastar-mastering-real-time-strategy-game-starcraft-ii) beat the player ["MaNa"](https://liquipedia.net/starcraft2/MaNa), a world class champion, 5-0, in the real-time multiplayer strategy game, [Starcraft 2](https://en.wikipedia.org/wiki/StarCraft_II:_Wings_of_Liberty). 
* In April of 2019, [OpenAI Five](https://openai.com/projects/five/) was able to beat the champions of [Dota 2](), a complex five man multiplayer online battle arena video game. [Paper](https://arxiv.org/pdf/1912.06680.pdf)

Here are some highlight clips that demostrate what the AI was able to accomplish in these games.

{% include image.html path="https://static.businessinsider.com/image/56e427fadd0895e8478b4657/image.gif?_ga=2.148718004.224853514.1586300146-524417318.1586300146" width="100%" text="World champion Lee is surpised by AlphaGo's actions" url_source="https://www.businessinsider.com.au/video-lee-se-dol-reaction-to-move-37-and-w102-vs-alphago-2016-3" url_text="BusinessInsider" %}

{% include image.html path="https://thumbs.gfycat.com/DisastrousNeatLemur-size_restricted.gif" width="100%" text="AlphaStar's army defeats MaNa's army"%}

{% include image.html path="https://thumbs.gfycat.com/EmbarrassedCharmingLhasaapso-size_restricted.gif" width="100%" text="OpenAI Five manages to kill four of the five members of OG during a fight"%}

Here are links to the matches:

* [AlphaGo vs Lee Sedol](https://www.youtube.com/watch?v=vFr3K2DORc8)
* [AlphaStar vs MaNa](https://www.youtube.com/watch?v=PFMRDm_H9Sg)
* [OpenAI Five vs OG](https://www.youtube.com/watch?v=LVrpWrvHVNE)

## League of Legends

League of Legends is a [MOBA](https://en.wikipedia.org/wiki/Multiplayer_online_battle_arena) (Multiplyer Online Battle Arena), much like Dota 2. In League of Legends, the goal of a team is to destroy the other team's nexus (a tower unit). There are five players per team and two teams face off during a match. Each player can select one champion from a pool of 100+ champions to play. These champions are the characters that represent the player in the game and usually has four unique abilities that the champion can use. Each champion also have certain statistics, such as health, mana, armor and magic resist to boost the champion's offensive and defensive capabilities. The champion also can equip items bought from store to boost their statistics using gold. Gold is generated at a steady rate in the game and extra gold can be obtained by killing minions or enemy champions. Each player is assigned a role in a team -- top, mid, bot, support, jungle. The roles usually determines what champions players pick and where in the map the players choose to fight their enemies.

{% include image.html path="https://media.giphy.com/media/3ohs81nOlqzYHqiypW/giphy.gif" width="100%" text="The champion, Zed, uses multiple skills to defeat the champion, Camille"%}

[Here is a link to a more in depth guide to League of Legends](https://mobalytics.gg/blog/absolute-beginners-guide-to-league-of-legends/)

## What has been done in currently League of Legends?

There are quite a few machine learning projects that have been done with League of Legends. 

* [Dataset containing match information](https://www.kaggle.com/chuckephron/leagueoflegends)
    * Statistics include champions picked, win rate of players, etc
    * [Model to predict win percentage based champion selection](https://medium.com/trendkite-dev/machine-learning-league-of-legends-victory-predictions-8bc6cbc7754e)

* [Detecting champions on the minimap](https://medium.com/@farzatv/deepleague-leveraging-computer-vision-and-deep-learning-on-the-league-of-legends-mini-map-giving-d275fd17c4e0)
{% include image.html path="https://miro.medium.com/max/1280/1*2JoRTb2sr-2xz1FYM20iAg.gif" width="100%" text="Detecting champions on the minimap" url_source="https://medium.com/@farzatv/deepleague-leveraging-computer-vision-and-deep-learning-on-the-league-of-legends-mini-map-giving-d275fd17c4e0" url_text="Medium" %}

* [Voice Assistant](https://gosu.ai/platform/league-of-legends) that recommends players with advice to improve their gameplay
{% include youtube.html id="QGVL7Cp388E" %}

* [LeagueAI](https://arxiv.org/pdf/1905.13546.pdf) is a basic AI that performs basic actions by determining the state of the game via image detection
{% include youtube.html id="iB4PoNJuXzc" %}

## Moving forward

Some interesting problems in League of Legends have been tackled by the community and proved quite successful.
However, there are existing solutions that can be improved on and there are new problems that have never been attempted before.
The goal of the future posts are to explore and tackle possible problems and discuss my approach to them.

