---
layout:     post
title:      League of Legends data scraping the hard and tedious way for fun
date:       2025-02-12 06:00:00
summary:    league
categories: league
thumbnail:  "/assets/images/posts/2024-11-02/league_rolf_format.svg"
comments:   true
tags:
 - League
jupyter:    true
---

# Before we begin

- Most of the work was done a couple years back (during COVID), so significant parts may have changed since then

# Disclaimer

This work isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing League of Legends. League of Legends and Riot Games are trademarks or registered trademarks of Riot Games, Inc.

# Table Of Content

- [Overview](#overview)
- [Current Datasets And Their Issues](#current-datasets-and-their-issues)
- [At 10000 feet](#at-10000-feet)
- [Replays](#replays)
- [Reverse Engineering](#reverse-engineering)
- [Performance](#performance)
- [Other Tidbits](#other-tidbits)
- [Thoughts](#thoughts)

# Overview

[League of Legends](https://en.wikipedia.org/wiki/League_of_Legends) is one of the world's most popular competitive games, with millions of players generating vast amounts of gameplay data daily. Basic match statistics are available, but accessing moment-by-moment gameplay data is near impossible. This article demonstrates how to create a high-fidelity dataset by reverse engineering the game engine, capturing information such as precise player positions to ability usage timings and damage calculations.

Current League of Legends datasets and analytics tools face several limitations:
- Granularity: Most available data comes from Riot's public APIs, which only provide aggregated statistics (total kills, gold earned, etc.) rather than detailed gameplay events
- Precision: Existing tools that sample game state often miss critical micro-interactions
- Completeness: Important gameplay elements like exact ability used, hiding in fog, positions data are missing

Because of this third-party developers can only build basic tools and datasets. We haven't seen announcements with regards to game-playing agents unlike other games where high fidelity data has enabled breakthoughs in reinforcement learning ~ [OpenAI5](https://openai.com/index/openai-five/), [AlphaStar](https://deepmind.google/discover/blog/alphastar-grandmaster-level-in-starcraft-ii-using-multi-agent-reinforcement-learning/).

I built a tool that can create high fidelity datasets. It directly decrypts and processes the game's internal replay files, but keeps the game's native data format. It can capture precise details like ability usage, movement, and state changes at millisecond intervals and can scale efficiently.

I'll walk through the technical challenges involved in reverse engineering League's proprietary game engine and replay format. These methods can be applied to similar problems in data extraction.

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">Expand to show sample of data scraped from a game</summary>
```json
{
  [
    {
      "CreateSummoner": {
        "time": 0.0,
        "id": 1073741859,
        "name": "SomeUserName",
        "champion": "akali"
      }
    },
    {
      "CastSpell": {
        "time": 10.23234,
        "champion_caster_id": 1073741859,
        "spell_name": "AkaliE",
        "level": 1,
        "source_position": {
          "x": 14045.15,
          "z": 13559.334
        },
        "target_position": {
          "x": 14400.824,
          "z": 14443.168
        },
        "target_end_position": {
          "x": 0.0,
          "z": 0.0
        },
        "target_ids": [],
        "windup_time": 0.25,
        "cooldown": 14.5,
        "mana_cost": 30.0,
        "slot": 2
      }
    },
    {
      "UpdateState": {
        "time": 721.11426,
        "1073741859": {
          [
            {
              "name": "health",
              "data": 1516.6107
            },
            {
              "name": "movement_speed",
              "data": 270.777
            },
          ]
        }
      }
    },
    {
      "BasicAttackAtTarget": {
        "time": 122.12,
        "source_id": 1073741859,
        "target_id": 1073741858,
        "source_position": {
          "x": 9222.389,
          "z": 2501.3594
        },
        "target_position": {
          "x": 9266.0,
          "z": 2522.0
        },
        "slot": 49,
        "spell_name": "AkaliP",
        "level": 0,
        "target_end_position": {
          "x": 0.0,
          "z": 0.0
        },
        "target_ids": [
          1073741858
        ],
        "windup_time": 1.3504388,
        "cooldown": 0.0,
        "mana_cost": 0.0
      }
    },
    {
      "CreateEntity": {
        "time": 722.9974,
        "id": 1073770044,
        "position": {
          "x": 9326.244,
          "z": 2522.7634
        },
        "name": "TwilightShroud",
        "level": 1,
      }
    },
    {
      "BecomeVisibleInFogOfWar": {
        "time": 862.4249,
        "id": 1073741859
      }
    },
    {
      "Death": {
        "time": 860.31085,
        "id": 1073741859,
      }
    }
  ]
}
```
</details>

# Current Datasets And Their Issues

[League of Legends](https://en.wikipedia.org/wiki/League_of_Legends) is a popular [MOBA game](https://en.wikipedia.org/wiki/Multiplayer_online_battle_arena). With millions of games played daily, several companies<span class="sidenote-ref"></span><span class="sidenote">[Backseat.gg](https://www.backseat.gg/)</span><span class="sidenote-ref"></span><span class="sidenote">[blitz.gg](https://www.blitz.gg/)</span><span class="sidenote-ref"></span><span class="sidenote">[Mobalytics](https://mobalytics.gg/lol?int_source=homepage&int_medium=mainbutton)</span> have invested significant effort in analyzing gameplay data to improve the player experience. However, detailed, fine-grained data remains relatively hard to obtain.

Typical data sources provide only limited, high-level information. Despite these limitations, people build basic models use this data to build basic win prediction models <span class="sidenote-ref"></span><span class="sidenote">[Kaggle](https://www.kaggle.com/code/neelkudu28/league-of-legends-win-prediction-using-pycaret)</span> or create user interfaces for gameplay analysis<span class="sidenote-ref"></span><span class="sidenote">[Mobalytics](https://mobalytics.gg/lol?int_source=homepage&int_medium=mainbutton)</span>.

<!--
{% include image.html path="/assets/images/posts/2024-11-02/backseat.png" width="85%" text="Example of a startup providing analysis for league of legends" url_source="https://multiplatform.ai/tyler1-introduces-backseat-ai-for-league-of-legends-coaching/" url_text="Multiplatform.ai"%}
--->

The following section provides different ways to fetch data and what datasets exist out there. I'll show and explain what these datasets contain.

Most existing datasets are created by scraping recent games through the [official RIOT matches API](https://developer.riotgames.com/apis#match-v5/GET_getMatch). When provided with a match ID, this API returns a list of participating players and various game statistics and metrics.

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">Expand to show match description<span class="sidenote-ref"></span><span class="sidenote">https://developer.riotgames.com/apis#match-v5/GET_getMatch</span></summary>

{:.datatable .display .compact .cell-border .row-border .hover}
| Name | Data Type | Description |
|------|-----------|-------------|
| endOfGameResult | string | Refer to indicate if the game ended in termination. |
| gameCreation | long | Unix timestamp for when the game is created on the game server (i.e., the loading screen). |
| gameDuration | long | Prior to patch 11.20, this field returns the game length in milliseconds calculated from gameEndTimestamp - gameStartTimestamp. Post patch 11.20, this field returns the max timePlayed of any participant in the game in seconds. |
| gameEndTimestamp | long | Unix timestamp for when match ends on the game server. This timestamp can occasionally be significantly longer than when the match "ends". |
| gameId | long | |
| gameMode | string | Refer to the Game Constants documentation. |
| gameName | string | |
| gameStartTimestamp | long | Unix timestamp for when match starts on the game server. |
| gameType | string | |
| gameVersion | string | The first two parts can be used to determine the patch a game was played on. |
| mapId | int | Refer to the Game Constants documentation. |
| participants | List[ParticipantDto] | |
| platformId | string | Platform where the match was played. |
| queueId | int | Refer to the Game Constants documentation. |
| teams | List[TeamDto] | |
| tournamentCode | string | Tournament code used to generate the match. This field was added to match-v5 in patch 11.13 on June 23rd, 2021. |
| allInPings | int | Yellow crossed swords |
| assistMePings | int | Green flag |
| assists | int | |
| baronKills | int | |
| bountyLevel | int | |
| champExperience | int | |
| champLevel | int | |
| championId | int | Prior to patch 11.4, on Feb 18th, 2021, this field returned invalid championIds. |
| championName | string | |
| commandPings | int | Blue generic ping (ALT+click) |
| championTransform | int | This field is currently only utilized for Kayn's transformations. (Legal values: 0 - None, 1 - Slayer, 2 - Assassin) |
| consumablesPurchased | int | |
| challenges | ChallengesDto | |
| damageDealtToBuildings | int | |
| damageDealtToObjectives | int | |
| damageDealtToTurrets | int | |
| damageSelfMitigated | int | |
| deaths | int | |
| detectorWardsPlaced | int | |
| doubleKills | int | |
| dragonKills | int | |
| eligibleForProgression | boolean | |
| enemyMissingPings | int | Yellow questionmark |
| enemyVisionPings | int | Red eyeball |
| firstBloodAssist | boolean | |
| firstBloodKill | boolean | |
| firstTowerAssist | boolean | |
| firstTowerKill | boolean | |
| gameEndedInEarlySurrender | boolean | |
| fistBumpParticipation | int | |
| voidMonsterKill | int | |
| abilityUses | int | |
| acesBefore15Minutes | int | |
| alliedJungleMonsterKills | float | |
| baronTakedowns | int | |
| blastConeOppositeOpponentCount | int | |
| bountyGold | int | |
| buffsStolen | int | |
| completeSupportQuestInTime | int | |
| controlWardsPlaced | int | |
| damagePerMinute | float | |
| damageTakenOnTeamPercentage | float | |
| dancedWithRiftHerald | int | |
| deathsByEnemyChamps | int | |
| dodgeSkillShotsSmallWindow | int | |
| doubleAces | int | |
| dragonTakedowns | int | |
| legendaryItemUsed | List[int] | |
| effectiveHealAndShielding | float | |
| elderDragonKillsWithOpposingSoul | int | |
| elderDragonMultikills | int | |
| enemyChampionImmobilizations | int | |
| enemyJungleMonsterKills | float | |
| epicMonsterKillsNearEnemyJungler | int | |
| epicMonsterKillsWithin30SecondsOfSpawn | int | |
| epicMonsterSteals | int | |
| epicMonsterStolenWithoutSmite | int | |
| firstTurretKilled | int | |
| firstTurretKilledTime | float | |
| flawlessAces | int | |
| fullTeamTakedown | int | |
| gameLength | float | |

</details>

These fields provide coarse, post-processed data from Riot, typically containing aggregate statistics like total kills, wards placed, and other cumulative events.

The [Live Client API (LCU)](https://developer.riotgames.com/docs/lol#game-client-api_live-client-data-api) offers a more detailed alternative, but requires running the game client. While it provides event timestamps (like deaths, destroyed turrets, and objective kills), it still lacks crucial data points such as player positions and ability usage timestamps.

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">Expand to show LCU API json example<span class="sidenote-ref"></span><span class="sidenote">https://static.developer.riotgames.com/docs/lol/liveclientdata_sample.json</span></summary>
```javascript
{
  "activePlayer": {
    "abilities": {
      "E": {
        "abilityLevel": 0,
        "displayName": "Molten Shield",
        "id": "AnnieE",
        "rawDescription": "GeneratedTip_Spell_AnnieE_Description",
        "rawDisplayName": "GeneratedTip_Spell_AnnieE_DisplayName"
      },
      "Passive": {
        "displayName": "Pyromania",
        "id": "AnniePassive",
        "rawDescription": "GeneratedTip_Passive_AnniePassive_Description",
        "rawDisplayName": "GeneratedTip_Passive_AnniePassive_DisplayName"
      },
      "Q": {
        "abilityLevel": 0,
        "displayName": "Disintegrate",
        "id": "AnnieQ",
        "rawDescription": "GeneratedTip_Spell_AnnieQ_Description",
        "rawDisplayName": "GeneratedTip_Spell_AnnieQ_DisplayName"
      },
      "R": {
        "abilityLevel": 0,
        "displayName": "Summon: Tibbers",
        "id": "AnnieR",
        "rawDescription": "GeneratedTip_Spell_AnnieR_Description",
        "rawDisplayName": "GeneratedTip_Spell_AnnieR_DisplayName"
      },
      "W": {
        "abilityLevel": 0,
        "displayName": "Incinerate",
        "id": "AnnieW",
        "rawDescription": "GeneratedTip_Spell_AnnieW_Description",
        "rawDisplayName": "GeneratedTip_Spell_AnnieW_DisplayName"
      }
    },
    "championStats": {
      "abilityPower": 0.00000000000000,
      "armor": 0.00000000000000,
      "armorPenetrationFlat": 0.0,
      "armorPenetrationPercent": 0.0,
      "attackDamage": 0.00000000000000,
      "attackRange": 0.0,
      "attackSpeed": 0.00000000000000,
      "bonusArmorPenetrationPercent": 0.0,
      "bonusMagicPenetrationPercent": 0.0,
      "cooldownReduction": -0.00,
      "critChance": 0.0,
      "critDamage": 0.0,
      "currentHealth": 0.0,
      "healthRegenRate": 0.00000000000000,
      "lifeSteal": 0.0,
      "magicLethality": 0.0,
      "magicPenetrationFlat": 0.0,
      "magicPenetrationPercent": 0.0,
      "magicResist": 0.00000000000000,
      "maxHealth": 0.00000000000000,
      "moveSpeed": 0.00000000000000,
      "physicalLethality": 0.0,
      "resourceMax": 0.00000000000000,
      "resourceRegenRate": 0.00000000000000,
      "resourceType": "MANA",
      "resourceValue": 0.00000000000000,
      "spellVamp": 0.0,
      "tenacity": 0.0
    },
    "currentGold": 0.00000000000000,
    "fullRunes": {
      "generalRunes": [{
          "displayName": "Electrocute",
          "id": 8112,
          "rawDescription": "perk_tooltip_Electrocute",
          "rawDisplayName": "perk_displayname_Electrocute"
        },
        {
          "displayName": "Cheap Shot",
          "id": 8126,
          "rawDescription": "perk_tooltip_CheapShot",
          "rawDisplayName": "perk_displayname_CheapShot"
        },
        {
          "displayName": "Eyeball Collection",
          "id": 8138,
          "rawDescription": "perk_tooltip_EyeballCollection",
          "rawDisplayName": "perk_displayname_EyeballCollection"
        },
        {
          "displayName": "Relentless Hunter",
          "id": 8105,
          "rawDescription": "perk_tooltip_8105",
          "rawDisplayName": "perk_displayname_8105"
        },
        {
          "displayName": "Celerity",
          "id": 8234,
          "rawDescription": "perk_tooltip_Celerity",
          "rawDisplayName": "perk_displayname_Celerity"
        },
        {
          "displayName": "Gathering Storm",
          "id": 8236,
          "rawDescription": "perk_tooltip_GatheringStorm",
          "rawDisplayName": "perk_displayname_GatheringStorm"
        }
      ],
      "keystone": {
        "displayName": "Electrocute",
        "id": 8112,
        "rawDescription": "perk_tooltip_Electrocute",
        "rawDisplayName": "perk_displayname_Electrocute"
      },
      "primaryRuneTree": {
        "displayName": "Domination",
        "id": 8100,
        "rawDescription": "perkstyle_tooltip_7200",
        "rawDisplayName": "perkstyle_displayname_7200"
      },
      "secondaryRuneTree": {
        "displayName": "Sorcery",
        "id": 8200,
        "rawDescription": "perkstyle_tooltip_7202",
        "rawDisplayName": "perkstyle_displayname_7202"
      },
      "statRunes": [{
          "id": 5008,
          "rawDescription": "perk_tooltip_StatModAdaptive"
        },
        {
          "id": 5003,
          "rawDescription": "perk_tooltip_StatModMagicResist"
        },
        {
          "id": 5003,
          "rawDescription": "perk_tooltip_StatModMagicResist"
        }
      ]
    },
    "level": 1,
    "summonerName": "Riot Tuxedo"
  },
  "allPlayers": [{
    "championName": "Annie",
    "isBot": false,
    "isDead": false,
    "items": [],
    "level": 1,
    "position": "",
    "rawChampionName": "game_character_displayname_Annie",
    "respawnTimer": 0.0,
    "runes": {
      "keystone": {
        "displayName": "Electrocute",
        "id": 8112,
        "rawDescription": "perk_tooltip_Electrocute",
        "rawDisplayName": "perk_displayname_Electrocute"
      },
      "primaryRuneTree": {
        "displayName": "Domination",
        "id": 8100,
        "rawDescription": "perkstyle_tooltip_7200",
        "rawDisplayName": "perkstyle_displayname_7200"
      },
      "secondaryRuneTree": {
        "displayName": "Sorcery",
        "id": 8200,
        "rawDescription": "perkstyle_tooltip_7202",
        "rawDisplayName": "perkstyle_displayname_7202"
      }
    },
    "scores": {
      "assists": 0,
      "creepScore": 0,
      "deaths": 0,
      "kills": 0,
      "wardScore": 0.0
    },
    "skinID": 0,
    "summonerName": "Riot Tuxedo",
    "summonerSpells": {
      "summonerSpellOne": {
        "displayName": "Flash",
        "rawDescription": "GeneratedTip_SummonerSpell_SummonerFlash_Description",
        "rawDisplayName": "GeneratedTip_SummonerSpell_SummonerFlash_DisplayName"
      },
      "summonerSpellTwo": {
        "displayName": "Ignite",
        "rawDescription": "GeneratedTip_SummonerSpell_SummonerDot_Description",
        "rawDisplayName": "GeneratedTip_SummonerSpell_SummonerDot_DisplayName"
      }
    },
    "team": "ORDER"
  }],
  "events": {
    "Events": [{
      "EventID": 0,
      "EventName": "GameStart",
      "EventTime": 0.00000000000000000
    }]
  },
  "gameData": {
    "gameMode": "CLASSIC",
    "gameTime": 0.000000000,
    "mapName": "Map11",
    "mapNumber": 11,
    "mapTerrain": "Default"
  }
}
```

</details>

The Live Client API provides more granular data than the Match API by including timestamps for key events like deaths, turret destructions, and objective kills. However, it still lacks crucial gameplay details such as player positions, ability usage, and combat interactions.

Several public datasets are available, with Kaggle being a prominent source. A [popular Kaggle example](https://www.kaggle.com/code/servietsky/league-of-legends-what-to-do-in-first-10-min#1.-Libraries-for-Fun-) demonstrates typical data granularity ~ per-game totals (dragon/baron kills, champion kills, wards placed), and per-minute metrics (CS/gold rates). These datasets generally rely on the RIOT Match API, inheriting its limitations.

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">Expand to show detailed data</summary>

{:.datatable .display .compact .cell-border .row-border .hover}
| gameId | blueWins | blueWardsPlaced | blueWardsDestroyed | blueFirstBlood | blueKills | blueDeaths | blueAssists | blueEliteMonsters | blueDragons | blueHeralds | blueTowersDestroyed | blueTotalGold | blueAvgLevel | blueTotalExperience | blueTotalMinionsKilled | blueTotalJungleMinionsKilled | blueGoldDiff | blueExperienceDiff | blueCSPerMin | blueGoldPerMin | redWardsPlaced | redWardsDestroyed | redFirstBlood | redKills | redDeaths | redAssists | redEliteMonsters | redDragons | redHeralds | redTowersDestroyed | redTotalGold | redAvgLevel | redTotalExperience | redTotalMinionsKilled | redTotalJungleMinionsKilled | redGoldDiff | redExperienceDiff | redCSPerMin | redGoldPerMin |
|---------|-----------|-----------------|-------------------|----------------|------------|-------------|--------------|------------------|--------------|-------------|-------------------|---------------|--------------|-------------------|---------------------|----------------------------|--------------|-------------------|--------------|----------------|----------------|------------------|--------------|-----------|------------|------------|-----------------|------------|------------|-------------------|--------------|--------------|-------------------|---------------------|----------------------------|-------------|------------------|-------------|---------------|
| 4519157822 | 0 | 28 | 2 | 1 | 9 | 6 | 11 | 0 | 0 | 0 | 0 | 17210 | 6.6 | 17039 | 195 | 36 | 643 | -8 | 19.5 | 1721.0 | 15 | 6 | 0 | 6 | 9 | 8 | 0 | 0 | 0 | 0 | 16567 | 6.8 | 17047 | 197 | 55 | -643 | 8 | 19.7 | 1656.7 |
| 4523371949 | 0 | 12 | 1 | 0 | 5 | 5 | 5 | 0 | 0 | 0 | 0 | 14712 | 6.6 | 16265 | 174 | 43 | -2908 | -1173 | 17.4 | 1471.2 | 12 | 1 | 1 | 5 | 5 | 2 | 2 | 1 | 1 | 1 | 17620 | 6.8 | 17438 | 240 | 52 | 2908 | 1173 | 24.0 | 1762.0 |
| 4521474530 | 0 | 15 | 0 | 0 | 7 | 11 | 4 | 1 | 1 | 0 | 0 | 16113 | 6.4 | 16221 | 186 | 46 | -1172 | -1033 | 18.6 | 1611.3 | 15 | 3 | 1 | 11 | 7 | 14 | 0 | 0 | 0 | 0 | 17285 | 6.8 | 17254 | 203 | 28 | 1172 | 1033 | 20.3 | 1728.5 |
| 4524384067 | 0 | 43 | 1 | 0 | 4 | 5 | 5 | 1 | 0 | 1 | 0 | 15157 | 7.0 | 17954 | 201 | 55 | -1321 | -7 | 20.1 | 1515.7 | 15 | 2 | 1 | 5 | 4 | 10 | 0 | 0 | 0 | 0 | 16478 | 7.0 | 17961 | 235 | 47 | 1321 | 7 | 23.5 | 1647.8 |
| 4436033771 | 0 | 75 | 4 | 0 | 6 | 6 | 6 | 0 | 0 | 0 | 0 | 16400 | 7.0 | 18543 | 210 | 57 | -1004 | 230 | 21.0 | 1640.0 | 17 | 2 | 1 | 6 | 6 | 7 | 1 | 1 | 0 | 0 | 17404 | 7.0 | 18313 | 225 | 67 | 1004 | -230 | 22.5 | 1740.4 |
| 4475365709 | 1 | 18 | 0 | 0 | 5 | 3 | 6 | 1 | 1 | 0 | 0 | 15899 | 7.0 | 18161 | 225 | 42 | 698 | 101 | 22.5 | 1589.9 | 36 | 5 | 1 | 3 | 5 | 2 | 0 | 0 | 0 | 0 | 15201 | 7.0 | 18060 | 221 | 59 | -698 | -101 | 22.1 | 1520.1 |
| 4493010632 | 1 | 18 | 3 | 1 | 7 | 6 | 7 | 1 | 1 | 0 | 0 | 16874 | 6.8 | 16967 | 225 | 53 | 2411 | 1563 | 22.5 | 1687.4 | 57 | 1 | 0 | 6 | 7 | 9 | 0 | 0 | 0 | 0 | 14463 | 6.4 | 15404 | 164 | 35 | -2411 | -1563 | 16.4 | 1446.3 |
| 4496759358 | 0 | 16 | 2 | 0 | 5 | 13 | 3 | 0 | 0 | 0 | 0 | 15305 | 6.4 | 16138 | 209 | 48 | -2615 | -800 | 20.9 | 1530.5 | 15 | 0 | 1 | 13 | 5 | 11 | 1 | 1 | 0 | 0 | 17920 | 6.6 | 16938 | 157 | 54 | 2615 | 800 | 15.7 | 1792.0 |
| 4443048030 | 0 | 16 | 3 | 0 | 7 | 7 | 8 | 0 | 0 | 0 | 0 | 16401 | 7.2 | 18527 | 189 | 61 | -1979 | -771 | 18.9 | 1640.1 | 15 | 2 | 1 | 7 | 7 | 5 | 2 | 1 | 1 | 0 | 18380 | 7.2 | 19298 | 240 | 53 | 1979 | 771 | 24.0 | 1838.0 |
| 4509433346 | 1 | 13 | 1 | 1 | 4 | 5 | 5 | 1 | 1 | 0 | 0 | 15057 | 6.8 | 16805 | 220 | 39 | -1548 | -1574 | 22.0 | 1505.7 | 16 | 2 | 0 | 5 | 4 | 4 | 0 | 0 | 0 | 0 | 16605 | 6.8 | 18379 | 247 | 43 | 1548 | 1574 | 24.7 | 1660.5 |
| 4452162573 | 0 | 20 | 3 | 1 | 4 | 4 | 6 | 0 | 0 | 0 | 0 | 15474 | 6.6 | 16611 | 231 | 28 | 331 | -1585 | 23.1 | 1547.4 | 15 | 2 | 0 | 4 | 4 | 5 | 1 | 1 | 0 | 0 | 15143 | 7.2 | 18196 | 216 | 51 | -331 | 1585 | 21.6 | 1514.3 |
| 4453038156 | 0 | 33 | 2 | 1 | 11 | 11 | 7 | 1 | 0 | 1 | 0 | 16695 | 7.0 | 18507 | 157 | 40 | -1505 | -635 | 15.7 | 1669.5 | 17 | 1 | 0 | 11 | 11 | 9 | 0 | 0 | 0 | 0 | 18200 | 7.0 | 19142 | 188 | 52 | 1505 | 635 | 18.8 | 1820.0 |
| 4515594785 | 1 | 18 | 1 | 1 | 7 | 1 | 11 | 1 | 1 | 0 | 0 | 17865 | 7.4 | 19102 | 238 | 53 | 3274 | 1659 | 23.8 | 1786.5 | 12 | 1 | 0 | 1 | 7 | 1 | 0 | 0 | 0 | 0 | 14591 | 6.8 | 17443 | 240 | 50 | -3274 | -1659 | 24.0 | 1459.1 |
| 4524924257 | 0 | 14 | 3 | 0 | 4 | 9 | 1 | 1 | 0 | 1 | 0 | 14979 | 6.6 | 17213 | 210 | 52 | -3414 | -1141 | 21.0 | 1497.9 | 20 | 3 | 1 | 9 | 4 | 11 | 0 | 0 | 0 | 0 | 18393 | 7.2 | 18354 | 229 | 51 | 3414 | 1141 | 22.9 | 1839.3 |
| 4516505202 | 1 | 15 | 3 | 1 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 15722 | 6.8 | 17896 | 224 | 51 | -470 | -187 | 22.4 | 1572.2 | 102 | 1 | 0 | 4 | 4 | 3 | 0 | 0 | 0 | 0 | 16192 | 7.0 | 18083 | 242 | 48 | 470 | 187 | 24.2 | 1619.2 |
| 4482120064 | 0 | 17 | 1 | 0 | 3 | 7 | 3 | 0 | 0 | 0 | 0 | 15015 | 6.8 | 16974 | 209 | 53 | -1996 | -1804 | 20.9 | 1501.5 | 18 | 3 | 1 | 7 | 3 | 13 | 0 | 0 | 0 | 0 | 17011 | 7.2 | 18778 | 237 | 51 | 1996 | 1804 | 23.7 | 1701.1 |
| 4523758462 | 1 | 14 | 1 | 1 | 10 | 2 | 8 | 0 | 0 | 0 | 0 | 19733 | 7.6 | 20862 | 263 | 56 | 5228 | 3378 | 26.3 | 1973.3 | 13 | 2 | 0 | 2 | 10 | 2 | 1 | 1 | 0 | 0 | 14505 | 6.8 | 17484 | 210 | 64 | -5228 | -3378 | 21.0 | 1450.5 |
| 4503636905 | 0 | 43 | 3 | 0 | 3 | 7 | 3 | 1 | 0 | 1 | 0 | 14852 | 6.8 | 16888 | 203 | 54 | -1975 | -1345 | 20.3 | 1485.2 | 17 | 14 | 1 | 7 | 3 | 6 | 0 | 0 | 0 | 0 | 16827 | 6.8 | 18233 | 218 | 53 | 1975 | 1345 | 21.8 | 1682.7 |
| 4486384947 | 1 | 21 | 4 | 1 | 5 | 4 | 11 | 0 | 0 | 0 | 0 | 16282 | 6.8 | 17378 | 213 | 49 | 882 | 512 | 21.3 | 1628.2 | 19 | 3 | 0 | 4 | 5 | 3 | 2 | 1 | 1 | 0 | 15400 | 6.6 | 16866 | 228 | 52 | -882 | -512 | 22.8 | 1540.0 |
| 4457103291 | 0 | 11 | 3 | 0 | 5 | 9 | 5 | 0 | 0 | 0 | 0 | 14994 | 7.0 | 17924 | 188 | 48 | -3155 | -2773 | 18.8 | 1499.4 | 15 | 1 | 1 | 9 | 5 | 9

</details>

Some third-party vendors partnered with RIOT offer additional APIs. For instance, the [Overwolf API](https://dev.overwolf.com/ow-native/reference/live-game-data-gep/supported-games/league-of-legends) combines features from both RIOT APIs but doesn't provide significant additional granularity beyond the official sources.

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">Expand to show detailed data</summary>
```python
{
  "info": {
    "live_client_data": {
      "active_player": {
        "abilities": {
          "E": {
            "abilityLevel": 0,
            "displayName": "Stacked Deck",
            "id": "CardmasterStack",
            "rawDescription": "GeneratedTip_Spell_CardmasterStack_Description",
            "rawDisplayName": "GeneratedTip_Spell_CardmasterStack_DisplayName"
          },
          "Passive": {
            "displayName": "Loaded Dice",
            "id": "SecondSight",
            "rawDescription": "GeneratedTip_Passive_SecondSight_Description",
            "rawDisplayName": "GeneratedTip_Passive_SecondSight_DisplayName"
          },
          "Q": {
            "abilityLevel": 0,
            "displayName": "Wild Cards",
            "id": "WildCards",
            "rawDescription": "GeneratedTip_Spell_WildCards_Description",
            "rawDisplayName": "GeneratedTip_Spell_WildCards_DisplayName"
          },
          "R": {
            "abilityLevel": 0,
            "displayName": "Destiny",
            "id": "Destiny",
            "rawDescription": "GeneratedTip_Spell_Destiny_Description",
            "rawDisplayName": "GeneratedTip_Spell_Destiny_DisplayName"
          },
          "W": {
            "abilityLevel": 0,
            "displayName": "Pick a Card",
            "id": "PickACard",
            "rawDescription": "GeneratedTip_Spell_PickACard_Description",
            "rawDisplayName": "GeneratedTip_Spell_PickACard_DisplayName"
          }
        },
        "championStats": {
          "abilityHaste": 0,
          "abilityPower": 0,
          "armor": 21,
          "armorPenetrationFlat": 0,
          "armorPenetrationPercent": 1,
          "attackDamage": 25,
          "attackRange": 0,
          "attackSpeed": 0.6510000228881836,
          "bonusArmorPenetrationPercent": 1,
          "bonusMagicPenetrationPercent": 1,
          "cooldownReduction": 0,
          "critChance": 0,
          "critDamage": 0,
          "currentHealth": 534,
          "healthRegenRate": 0,
          "lifeSteal": 0,
          "magicLethality": 0,
          "magicPenetrationFlat": 0,
          "magicPenetrationPercent": 1,
          "magicResist": 30,
          "maxHealth": 534,
          "moveSpeed": 330,
          "physicalLethality": 0,
          "resourceMax": 333,
          "resourceRegenRate": 0,
          "resourceType": "MANA",
          "resourceValue": 333,
          "spellVamp": 0,
          "tenacity": 0
        },
        "currentGold": 0,
        "fullRunes": {
          "generalRunes": [
            {
              "displayName": "Dark Harvest",
              "id": 8128,
              "rawDescription": "perk_tooltip_DarkHarvest",
              "rawDisplayName": "perk_displayname_DarkHarvest"
            },
            {
              "displayName": "Taste of Blood",
              "id": 8139,
              "rawDescription": "perk_tooltip_TasteOfBlood",
              "rawDisplayName": "perk_displayname_TasteOfBlood"
            },
            {
              "displayName": "Eyeball Collection",
              "id": 8138,
              "rawDescription": "perk_tooltip_EyeballCollection",
              "rawDisplayName": "perk_displayname_EyeballCollection"
            },
            {
              "displayName": "Ravenous Hunter",
              "id": 8135,
              "rawDescription": "perk_tooltip_RavenousHunter",
              "rawDisplayName": "perk_displayname_RavenousHunter"
            },
            {
              "displayName": "Presence of Mind",
              "id": 8009,
              "rawDescription": "perk_tooltip_PresenceOfMind",
              "rawDisplayName": "perk_displayname_PresenceOfMind"
            },
            {
              "displayName": "Coup de Grace",
              "id": 8014,
              "rawDescription": "perk_tooltip_CoupDeGrace",
              "rawDisplayName": "perk_displayname_CoupDeGrace"
            }
          ],
          "keystone": {
            "displayName": "Dark Harvest",
            "id": 8128,
            "rawDescription": "perk_tooltip_DarkHarvest",
            "rawDisplayName": "perk_displayname_DarkHarvest"
          },
          "primaryRuneTree": {
            "displayName": "Domination",
            "id": 8100,
            "rawDescription": "perkstyle_tooltip_7200",
            "rawDisplayName": "perkstyle_displayname_7200"
          },
          "secondaryRuneTree": {
            "displayName": "Precision",
            "id": 8000,
            "rawDescription": "perkstyle_tooltip_7201",
            "rawDisplayName": "perkstyle_displayname_7201"
          },
          "statRunes": [
            { "id": 5008, "rawDescription": "perk_tooltip_StatModAdaptive" },
            { "id": 5008, "rawDescription": "perk_tooltip_StatModAdaptive" },
            { "id": 5003, "rawDescription": "perk_tooltip_StatModMagicResist" }
          ]
        },
        "level": 1,
        "summonerName": "Sh4rgaas"
      }
    }
  },
  "feature": "live_client_data"
}
```
</details>

## Using The Datasets

Startups currently use these datasets to provide player analysis and insights. Access to more granular data would enable significantly deeper and more sophisticated analysis tools.

{% include image.html path="/assets/images/posts/2024-11-02/blitz.png" width="80%" text="Example of overlays provided in game" url_source="https://blitz.gg/overlays/lol" url_text="blitz.gg"%}

Blitz.gg that give timers and pathing for players which is pretty cool!

{% include image.html path="/assets/images/posts/2024-11-02/backseat_help.png" width="80%" text="AI voice suggestions" url_source="https://www.backseat.gg/#features" url_text="backseat.gg"%}

Some startups give AI suggestions to help with gameplay.

{% include image.html path="/assets/images/posts/2024-11-02/ugg_analysis.png" width="80%" text="U.GG post game analysis" url_source="https://www.u.gg/" url_text="u.gg"%}

Others give deep analysis to one's gameplay.

# At 10000 Feet

## Overview

Here's a high level overview of the system, which I'll describe each part in the following sections

{% include image.html path="/assets/images/posts/2024-11-02/league_overview.svg" width="100%" text="Overview of the system"%}

## Replays And Packets

The process begins by fetching encrypted replay files from a data source. These replays contain compressed gameplay state data that the League of Legends client uses to reconstruct game sessions for viewing.
After decryption and decompression, the system processes individual encrypted packets through an emulator, which converts them into structured JSON format. The complete process and replay format are detailed in the [rofl format section](#rofl-replay).

## Emulator And Decryption Background

The emulator<span class="sidenote-ref"></span><span class="sidenote">Emulator is software that runs an architecture. It's used here to run specific parts of league of legends binary without running the entire game (useful for debugging and seeing what variables are important). An example of an emulator is [unicorn engine](https://www.unicorn-engine.org/)</span> inspects and debugs the League of Legends binary to handle encrypted packets. Packet data is decrypted when accessed and immediately re-encrypted afterward<span class="sidenote-ref"></span><span class="sidenote">You also might say: you still don't need an emulator because you can figure out how decryption works and write your own code to decrypt the entire packet buffer without running an emulator. <br/>
League of legends is an actively updated game and thus the decryption changes often, so the emulator makes debugging much easier <br/>
</span>.

Here's a simple Python example demonstrating packet decryption using XOR:

{% include image.html path="/assets/images/posts/2024-11-02/league_emulator_python.svg" width="100%" text="TakeDamagePacket has two fields we're interested in extracting information out of"%}

The TakeDamage packet contains two encrypted fields: the target object and damage amount. For this example, we'll use a simple XOR operation with 0x69 to decrypt these values.

<iframe src="https://trinket.io/embed/python3/26d5c490981d?runOption=run&start=result" width="100%" height="356" frameborder="0" marginwidth="0" marginheight="0" allowfullscreen></iframe>

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">Expand to show code (in-case above python doesn't show)</summary>

```python
# Champion has hp and other fields
class Champion:
  def __init__(self, name, id, hp):
    self.name = name
    self.id = id
    self.hp = hp
    
  def __str__(self):
    return f'{self.name}: id [{self.id}] has {self.hp} hp remaining\n'
    
# Encryption/Decryption using XOR -- not real thing
KEY=0x69
def decrypt(data: bytes) -> bytes:
    return bytes(data[i] ^ KEY for i in range(len(data)))

def encrypt(data: bytes) -> bytes:
    return bytes(data[i] ^ KEY for i in range(len(data)))

class TakeDamagePacket:
  def __init__(self, buffer):
    self.buffer = buffer
  
  def target_id_bytes(self) -> bytes:
    return self.buffer[12:16]
    
  def damage_bytes(self) -> bytes:
    return self.buffer[16:20]

# Helper functions
def convert_bytes_to_int(data: bytes) -> int:
  return int.from_bytes(data, byteorder='big')

name = 'Ezreal'
id = 10
hp = 1000
ezreal = Champion(name, id, hp)
print(ezreal)

# example data from rofl file...
buffer = b'\xeb\x9d\x65\x38\xd3\x0e\x47\xfa\xa1\x29\x13\x9b\x69\x69\x69\x63\x69\x69\x68\x45\x75\xe2\x3e\x9f\x50\xfb\xa8\x26\x1f\xc7\x47\x47\x47'

packet = TakeDamagePacket(buffer)

# First, check if the target is ezreal

# Fetch the offset in packet to target id
encrypted_target_id_bytes = packet.target_id_bytes()
print(f'Encrypted target id bytes[' + ''.join(f'\\x{b:02x}' for b in encrypted_target_id_bytes) + ']')

# Decrypt the bytes and convert to int
target_id_bytes = decrypt(encrypted_target_id_bytes)
print(f'Decrypted target id bytes[' + ''.join(f'\\x{b:02x}' for b in target_id_bytes) + ']')

target_id = convert_bytes_to_int(target_id_bytes)
print(f'\nTarget id [{target_id}] == Ezreal id [{ezreal.id}]?')

if target_id == ezreal.id:
  # After access, remove variable and encrypt bytes
  del target_id
  target_id_bytes = encrypt(target_id_bytes)
  print('Damage target is Ezreal\n')
  print(f'Reencrypt target id bytes[' + ''.join(f'\\x{b:02x}' for b in target_id_bytes) + ']')

  # Ezreal took some damage
  encrypted_damage_bytes = packet.damage_bytes()
  print(f'Encrypted damage bytes[' + ''.join(f'\\x{b:02x}' for b in encrypted_damage_bytes) + ']')
  damage_bytes = decrypt(encrypted_damage_bytes)
  print(f'Decrypted damage bytes[' + ''.join(f'\\x{b:02x}' for b in damage_bytes) + ']')
  damage = convert_bytes_to_int(damage_bytes)

  print(f'\nOh no, id [{id}] (Ezreal) took {damage} damage!')
  ezreal.hp -= damage
  print(ezreal)

  del damage
  damage_bytes = encrypt(damage_bytes)
  print(f'Reencrypt damage bytes[' + ''.join(f'\\x{b:02x}' for b in damage_bytes) + ']')
```

</details>

Each packet field undergoes a decrypt-access-release cycle. In the TakeDamagePacket example, when checking if Ezreal is the target, the `id` field is decrypted, compared, and immediately re-encrypted and deleted. Once the comparison is complete, the decrypted reference is deleted. The same process applies to the damage field. This pattern (unintentionally) is a good defense against memory scanners<span class="sidenote-ref"></span><span class="sidenote">Memory scanners such as Cheat Engine allows reverse engineers to find determinstic values in memory and be able to trace them back to the code that modifies or reads the values. By deleting the value, it makes it harder for reverse engineers to find important values and thus, important sections of code that produces that value</span>.

# Replays

## Data sources

Replays files are available through the official league client or third-party websites such as [op.gg](https://www.op.gg/) or [Mobalytics](https://mobalytics.gg/). The replays end in the [.rofl](https://dictionary.cambridge.org/us/dictionary/english/rofl)
<span class="sidenote-ref"></span><span class="sidenote">Interesting name to choose for the file extension</span>.

### How Replays Are Viewed

Players can watch replays through either the League client interface or command line.

{% include image.html path="/assets/images/posts/2024-11-02/replay_client.png" width="100%" text="Example of how to view a replay through the client"%}

## ROFL Replay

While the ROFL replay format is undocumented, [community efforts have reverse-engineered its structure](https://github.com/fraxiinus/roflxd.cs/tree/master/Rofl.Extract.Data/Models/Rofl). Here's a simplified version of the format:

{% include image.html path="/assets/images/posts/2024-11-02/league_rolf_format.svg" width="100%" text="The ROFL file format"%}

The key components are the `encrypted chunks`. Each `chunk` contains packet metadata (`time`, `type`, `size`) and encrypted packet data. While the timestamps tell us when events occur, we still need to figure out what the packets actually do.

## Visually Tracing How Packets Are Used

To understand packet structures, we can analyze what the client must process during replay playback. Let's examine a specific game frame:

{% include image.html path="/assets/images/posts/2024-11-02/replay.png" width="100%" text="Example of viewing a replay" url_source="https://na.leagueoflegends.com/en/featured/preseason-2017/replays-and-practice" url_text="League Of Legends"%}

Frame Analysis (Timestamp 4:02):

There are four champions in the image.
- Jhin, champion with blue hp on bottom left
- Braum, 
- Thresh,
- Ezreal,

Two key actions are occurring:

- Jhin is taking damage (as indicated by a small red indicator of his health bar).
- Ezreal and Thresh (red health bars) moving leftward

We should expect at least two packets:
- Damage Packet
  - Jhin's id
  - float value for damage taken
- Movement packet
  - Ezreal or Thresh's id
  - X, Y, Z coordinates
  - Start and end positions

These packets should align with the timestamp and visible game state. The next section will explore their detailed implementation.

# Reverse Engineering

## Some Background

League of Legends runs on a custom game engine developed in [2009]((https://en.wikipedia.org/wiki/League_of_Legends)). At that time, Unreal Engine was the primary commercial option, as Unity hadn't yet emerged. This means we're working with a closed-source game engine.

While RIOT's technical blogs offer insights into their engine<span class="sidenote">[Planning a future game engine for league which discusses the issues with the current game engine](https://technology.riotgames.com/news/future-leagues-engine)</span><span class="sidenote-ref"></span><span class="sidenote">[Graphics pipeline](https://technology.riotgames.com/news/trip-down-lol-graphics-pipeline)</span>, they don't reveal the implementation details we need.

Our analysis focuses on the I/O and networking layers where packet processing occurs. We're particularly interested in the pipeline<span class="sidenote-ref"></span><span class="sidenote">In this context, a pipeline as a process that takes an input, transforms the input and splits out an output</span> that transforms raw packet data into game state:

{% include image.html path="/assets/images/posts/2024-11-02/league_packet_to_game_state.svg" width="100%" text="A stream of packets flows through a game engine to update game state"%}

## Packet Processing

Packets are done in 3 steps:
- Memory Allocation (`Packet::Packet`)
  - Sets up packet metadata
  - Allocates space for packet data
- Deserialization (`DeserializePacket`)
  - Converts chunk data to in-memory representation
  - Extracts some information from the chunk data as packet fields
- Game State Update (`UsePacket`)
  - Applies packet data to game state

```cpp
GameState game_state;

int ParseBufferAndUpdateGameState(char* buffer, uint64_t buffer_size)
{
  // Read the packet type from the buffer
  uint16_t packet_type = *(uint16_t*)buffer;

  // Allocate an empty packet data structure
  Packet packet(packet_type);

  // Parse buffer into packet data structure
  int status_ok = packet.deserialize(buffer, buffer_size);

  // Update game state with packet
  if (status_ok)
    game_state.use_packet(&packet);

  // At this point, the packet is deallocated,
  // invoking the destructor Packet::~Packet()
  return status_ok;
}
```

Here's an example of `TakeDamagePacket`'s DeserializePacket function

```cpp
enum PacketType : uint16_t
{
  TAKE_DAMAGE = 0x2385,
};

struct TakeDamagePacket : public Packet
{
  PacketType packet_type;
  char* data; // To be parsed later by game state (this contains the source and target id and how much damage was applied)
  int expected_size = 12; // Should expect this left in the buffer
  bool flag1 = false; // Other misc data parsed
}

virtual bool TakeDamagePacket::deserialize(char* buffer, uint64_t buffer_size)
{
  // Skip the packet type from buffer
  char* start_buffer = buffer + sizeof(PacketType);

  // Check if buffer has enough size to read into this packet
  if (buffer_size - sizeof(PacketType) < expected_size)
  {
    return false;
  }

  // Copy the data over
  memcpy(this->data, start_buffer, this->expected_size);

  // See if certain flag is set
  if (start_buffer[3] == 79)
    this->flag1 = true;

  return true;
}
```

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">Click to expand to see how we got to packet decompiled code</summary>

The first decompiled code snippet below shows the parent function that takes in the raw chunk data, instantiates a specific packet object using a factory class to make a packet object based on its type. At this point, the packet object doesn't hold any information from the chunk data, so it deserializes the packet data called from its vtable (`(*(_QWORD *)packet + 8LL)(packet, &v19, (char *)v6 + v4)`, which is `DeserializePacket`). Now, the packet object contains metadata and the chunk data. Then, it uses it by calling from its vtable again (`(*(_QWORD *)v11 + 16LL))(v11, packet_, v20))`), which calls `UsePacket` to update the game state.

```cpp
__int64 __fastcall CallPacketsInOrder(__int64 a1, __int16 **raw_data, __int64 a3, double a4)
{
  __int64 packet; // [rsp+18h] [rbp-38h] BYREF
  __int16 packet_type; // [rsp+24h] [rbp-2Ch] BYREF

  packet_type = **raw_data;
  Packet::Packet(&packet, (unsigned __int16)packet_type);// Packet::Packet(&packet, packet_type);
  if ( !packet )
    return 0;
  v7 = (*(__int64 (__fastcall **)(__int64, __int16 **, char *))(*(_QWORD *)packet + 8LL))(packet, &v19, (char *)v6 + v4);// Calls Packet::Deserialize from packet's vtable
  packet_ = packet;
  *(double *)(a1 + 688) = v20;
  ...
          v11 = *(_QWORD *)(*(_QWORD *)(a1 + 696) + 8 * v10);
          v12 = (*(__int64 (__fastcall **)(__int64, __int64, double))(*(_QWORD *)v11 + 16LL))(v11, packet_, v20);// Calling UsePacket from Packet's VTable
  ...
  if ( packet )
    (*(void (__fastcall **)(__int64))(*(_QWORD *)packet + 32LL))(packet); // Call destructor to packet
  return v7;
}
```

### Decompiled Packet Code

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">Expand to show decompiled code for allocating memory</summary>
```c
int64 *fastcall Packet::Packet(PacketStruct *packet, int packet_type)
{
  switch ( a2 )
  {
    case 2:
      v4 = operator new(0xEuLL);
      *(_WORD *)(v4 + 8) = 2;
      *(_DWORD *)(v4 + 10) = 0;
      v5 = off_101BECE88;
      goto LABEL_639;
    case 3:
      v101 = operator new(0x28uLL);
      *(_WORD *)(v101 + 8) = 3;
      *(_DWORD *)(v101 + 10) = 0;
      *(_QWORD *)v101 = off_101BED530;
      *(_QWORD *)(v101 + 16) = 0LL;
      *(_QWORD *)(v101 + 24) = 0LL;
      *(_WORD *)(v101 + 32) = -22610;
      *packet = v101;
      return packet;
    case 5:
      v4 = operator new(0x20uLL);
      *(_WORD *)(v4 + 8) = 5;
      *(_DWORD *)(v4 + 10) = 0;
      v31 = off_101BEA880;
      goto LABEL_578;
    case 9:
      v4 = operator new(0x20uLL);
      *(_WORD *)(v4 + 8) = 9;
      *(_DWORD *)(v4 + 10) = 0;
      v31 = off_101BE9618;
      goto LABEL_578;
    case 10:
      v4 = operator new(0xEuLL);
      *(_WORD *)(v4 + 8) = 10;
      *(_DWORD *)(v4 + 10) = 0;
      v5 = off_101BECF80;
      goto LABEL_639;
    case 11:
      v381 = operator new(0x1CuLL);
      *(_WORD *)(v381 + 8) = 11;
      *(_DWORD *)(v381 + 10) = 0;
      *(_QWORD *)v381 = off_101BEDDC0;
      *(_QWORD *)(v381 + 16) = 0xE7E7E7E7E7E7E7E7LL;
      *(_DWORD *)(v381 + 24) = -404232217;
      *packet = v381;
      return packet;
    case 12:
      v6 = operator new(0x38uLL);
      *(_WORD *)(v6 + 8) = 12;
      *(_DWORD *)(v6 + 10) = 0;
      *(_QWORD *)v6 = off_101BEEA98;
      *(_QWORD *)(v6 + 16) = off_101BEEA60;
      *(_DWORD *)(v6 + 24) = 320017171;
      *(_QWORD *)(v6 + 32) = 0xBBBBBBBBBBBBBBBBLL;
      *(_QWORD *)(v6 + 40) = 0xCECECECE2E2E2E2ELL;
      *(_DWORD *)(v6 + 48) = -235802127;
      *packet = v6;
      return a1;
```
</details>

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">Expand to show decompiled code for decrypting packet</summary>
```c
char __fastcall DeserializePacket(Packet* packet, unsigned __int64 *a2, unsigned __int64 a3)
{
  v3 = *a2;
  if ( a3 - *a2 < 6 )
    return 0;
  v5 = a2;
  v6 = packet;
  *(_WORD *)(packet + 8) = *(_WORD *)v3;
  *(_DWORD *)(packet + 10) = *(_DWORD *)(v3 + 2);
  v7 = (__int16 *)*a2;
  v8 = (_BYTE *)(*a2 + 6);
  *a2 = (unsigned __int64)v8;
  if ( a3 - (unsigned __int64)v8 < 3 )
    return 0;
  *a2 = (unsigned __int64)v7 + 9;
  v10 = 86;
  if ( (v7[3] & 8) == 0 )
    v10 = 114;
  *(_BYTE *)(packet + 14) = v10;
  switch ( (*((unsigned __int8 *)v7 + 7) >> 4) & 7 )
  {
    case 0:
      *(_DWORD *)(packet + 16) = -1027423577;
      goto LABEL_20;
    case 1:
      if ( (unsigned __int8)sub_100D8D2F0(packet + 16, a2, a3) )
        goto LABEL_20;
      return 0;
    case 2:
      if ( (unsigned __int8)sub_100D8CFB0(packet + 16, a2, a3) )
        goto LABEL_20;
      return 0;
    case 3:
      if ( (unsigned __int8)sub_100D8D490(packet + 16, a2, a3) )
        goto LABEL_20;
      return 0;
    case 4:
      if ( (unsigned __int8)sub_100D8D150(packet + 16, a2, a3) )
        goto LABEL_20;
      return 0;
    case 5:
      *(_DWORD *)(packet + 16) = -1027423550;
      goto LABEL_20;
    case 6:
      *(_DWORD *)(packet + 16) = -1027423610;
      goto LABEL_20;
    case 7:
      *(_DWORD *)(packet + 16) = 1852730990;
```
</details>

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">Expand to show decompiled code for updating game state</summary>
```c
__int64 __fastcall UsePacket(
        __int64 a1,
        __int64 a2,
        __m128 a3,
        __m128 a4,
        double a5,
        double a6,
        double a7,
        double a8,
        double a9)
{
 v9 = *(double *)&a2;
  v10 = 1;
  switch ( *(_WORD *)(a2 + 8) )
  {
    case 0xA:
      sub_100384590(d);
      return v10;
    case 0xE:
      v564 = *(_DWORD *)(a2 + 16);
      v565 = ((187
             - ((65793
               * ((2050
                 * ((unsigned __int8)((65793
                                     * ((2050 * (unsigned __int8)(v564 - 86)) & 0x22110 | (32800
                                                                                         * (unsigned __int8)(v564 - 86)) & 0x88440u)) >> 16) ^ 0xE6)) & 0x22110 | (32800 * ((unsigned __int8)((65793 * ((2050 * (unsigned __int8)(v564 - 86)) & 0x22110 | (32800 * (unsigned __int8)(v564 - 86)) & 0x88440u)) >> 16) ^ 0xE6)) & 0x88440u)) >> 16)) ^ 0xED)
           + 244;
      v566 = (unsigned __int8)((65793
                              * ((2050 * (unsigned __int8)(HIBYTE(v564) - 86)) & 0x22110 | (32800
                                                                                          * (unsigned __int8)(HIBYTE(v564) - 86)) & 0x88440u)) >> 16) ^ 0xE6;
      v567 = c(
               d,
               ((unsigned __int16)(((-17664
                                   - (((65793
                                      * ((2050
                                        * ((unsigned __int8)((65793
                                                            * ((2050 * (unsigned __int8)(BYTE1(v564) - 86)) & 0x22110 | (32800 * (unsigned __int8)(BYTE1(v564) - 86)) & 0x88440u)) >> 16) ^ 0xE6)) & 0x22110 | (32800 * ((unsigned __int8)((65793 * ((2050 * (unsigned __int8)(BYTE1(v564) - 86)) & 0x22110 | (32800 * (unsigned __int8)(BYTE1(v564) - 86)) & 0x88440u)) >> 16) ^ 0xE6)) & 0x88440u)) >> 8) & 0xFF00)) ^ 0xED00)
                                 - 3072)
              + ((-1157627904 - ((16843008 * ((2050 * v566) & 0x22110 | (32800 * v566) & 0x88440)) & 0xFF000000)) ^ 0xED000000 | (((12255232 - ((65793 * ((2050 * ((unsigned __int8)((65793 * ((2050 * (unsigned __int8)(BYTE2(v564) - 86)) & 0x22110 | (32800 * (unsigned __int8)(BYTE2(v564) - 86)) & 0x88440u)) >> 16) ^ 0xE6)) & 0x22110 | (32800 * ((unsigned __int8)((65793 * ((2050 * (unsigned __int8)(BYTE2(v564) - 86)) & 0x22110 | (32800 * (unsigned __int8)(BYTE2(v564) - 86)) & 0x88440u)) >> 16) ^ 0xE6)) & 0x88440)) & 0xFF0000)) ^ 0xED0000) + 15990784) & 0xFF0000)
              - 201326592) | (unsigned __int8)v565);
      if ( v567 )
      {
        v568 = sub_1002F12F0(d, *(unsigned int *)(v567 + 16));
        if ( v568 )
        {
          v569 = v568;
          v570 = (*(__int64 (__fastcall **)(__int64))(*(_QWORD *)v568 + 16LL))(v568);
          v571 = sub_1000EE9E0();
          v = sub_123(v570, v569, v571);
          if ( v )
            (*(void (__fastcall **)(__int64, _QWORD))(*(_QWORD *)v + 2960LL))(
              v,
              (unsigned __int8)((((65793
                                 * ((2050
                                   * (unsigned __int8)((65793
                                                      * ((2050 * *(unsigned __int8 *)(a2 + 14)) & 0x22110 | (32800 * *(unsigned __int8 *)(a2 + 14)) & 0x88440u)) >> 16)) & 0x22110 | (32800 * (unsigned __int8)((65793 * ((2050 * *(unsigned __int8 *)(a2 + 14)) & 0x22110 | (32800 * *(unsigned __int8 *)(a2 + 14)) & 0x88440u)) >> 16)) & 0x88440u)) >> 15) & 0xAA)
                              + (((65793
                                 * ((2050
                                   * (unsigned __int8)((65793
                                                      * ((2050 * *(unsigned __int8 *)(a2 + 14)) & 0x22110 | (32800 * *(unsigned __int8 *)(a2 + 14)) & 0x88440u)) >> 16)) & 0x22110 | (32800 * (unsigned __int8)((65793 * ((2050 * *(unsigned __int8 *)(a2 + 14)) & 0x22110 | (32800 * *(unsigned __int8 *)(a2 + 14)) & 0x88440u)) >> 16)) & 0x88440u)) >> 17) & 0x55)
                              + 51));
        }
      }
      return v10;
    case 0x14:
      v27 = __ROL1__(*(_BYTE *)(a2 + 14), 5);
      v28 = __ROL1__(((v27 >> 1) & 0x55 | (2 * v27) & 0xAA) + 50, 3);
      sub_100384E20(
        d,
        (unsigned __int8)((65793 * ((2050 * v28) & 0x22110 | (32800 * v28) & 0x88440u)) >> 16) != 0);
      return v10;
    case 0x15:
      sub_101153C40();
      if ( *(_DWORD *)(a2 + 24) )
      {
        v930 = *(_QWORD *)(a2 + 16);
        v931 = 60LL * *(unsigned int *)(a2 + 24);
        do
        {
          sub_100170F20(v930);
          v930 += 60LL;
          v931 -= 60LL;
        }
        while ( v931 );
      }
      sub_1001BCB10(0LL);
      return v10;
```
</details>

As you may notice, all three functions is composed of a big switch statement: it's because it runs each `case` statement based on the packet type.

</details>

We're interested in how the packet is used to update game state. Let's take a look into that.

## Reading The Packet

After deserialization, we still can't directly read the packet data. The packet object maintains encrypted chunk data, only decrypting fields when they're accessed - as explained in the [emulator and decryption section](#emulator-and-decrypytion-background). Let's examine how this works in practice by analyzing the TakeDamage function, focusing on two key pieces of information that we want to extract: who is taking damage and how much damage they've taken.

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">Click to expand to view the raw decompiled TakeDamage function</summary>

```cpp
char __fastcall TakeDamage(__int64 idk, __int64 packet)
{
  v3 = *(_DWORD *)(packet + 16);
  v4 = HIWORD(v3);
  v5 = HIBYTE(v3);
  LOBYTE(v3) = __ROL1__(~byte_1019891E0[(unsigned __int8)~__ROL1__(v3, 4)], 4);
  v6 = byte_1019891E0[(unsigned __int8)(__ROL1__(
                                          ~byte_1019891E0[(unsigned __int8)~__ROL1__(BYTE1(*(_DWORD *)(packet + 16)), 4)],
                                          4)
                                      - 54)];
  v7 = 65793 * ((2050 * v6) & 0x22110 | (32800 * v6) & 0x88440);
  v8 = byte_1019891E0[(unsigned __int8)(__ROL1__(~byte_1019891E0[(unsigned __int8)~__ROL1__(v4, 4)], 4) - 54)];
  v9 = (2050 * v8) & 0x22110 | (32800 * v8) & 0x88440;
  v10 = byte_1019891E0[(unsigned __int8)(__ROL1__(~byte_1019891E0[(unsigned __int8)~__ROL1__(v5, 4)], 4) - 54)];
  target_object = GetInternalObjectFromID(
                    qword_101C60850,
                    (16843008 * ((2050 * v10) & 0x22110 | (32800 * v10) & 0x88440)) & 0xFF000000 | (65793 * v9) & 0xFF0000 | (v7 >> 8) & 0xFF00 | (unsigned __int8)((65793 * ((2050 * byte_1019891E0[(unsigned __int8)(v3 - 54)]) & 0x22110 | (32800 * byte_1019891E0[(unsigned __int8)(v3 - 54)]) & 0x88440u)) >> 16));
  ...
  source_object = GetInternalObjectFromID(
                    qword_101C60850,
                    ((unsigned __int8)(__ROR1__(
                                         byte_1019891E0[byte_1019891E0[(unsigned __int8)(-113
                                                                                       - HIBYTE(*(_DWORD *)(packet + 36)))]],
                                         1)
                                     + 89) << 24) | ((unsigned __int8)(__ROR1__(
                                                                         byte_1019891E0[byte_1019891E0[(unsigned __int8)(-113 - HIWORD(*(_DWORD *)(packet + 36)))]],
                                                                         1)
                                                                     + 89) << 16) | ((unsigned __int8)(__ROR1__(byte_1019891E0[byte_1019891E0[(unsigned __int8)(-113 - BYTE1(*(_DWORD *)(packet + 36)))]], 1) + 89) << 8) | (unsigned int)(unsigned __int8)(__ROR1__(byte_1019891E0[byte_1019891E0[(unsigned __int8)(-113 - *(_DWORD *)(packet + 36))]], 1) + 89));
  ...
  v46 = (HIWORD(*(_DWORD *)(packet + 24)) ^ 0xF2) + 9;
  (*(void (__fastcall **)(__int64, double))(*(_QWORD *)obj + 1920LL))(
    obj,
    *(double *)_mm_cvtsi32_si128(__ROL1__(      // float that represents damage taken
                                   ((unsigned __int8)((*(_DWORD *)(packet + 24) ^ 0xF2) + 9) >> 1) & 0x55 | (2 * ((*(_DWORD *)(packet + 24) ^ 0xF2) + 9)) & 0xAA,
                                   5) ^ 4 | ((__ROL1__(
                                                ((unsigned __int8)((BYTE1(*(_DWORD *)(packet + 24)) ^ 0xF2) + 9) >> 1) & 0x55 | (2 * ((BYTE1(*(_DWORD *)(packet + 24)) ^ 0xF2) + 9)) & 0xAA,
                                                5) ^ 4) << 8) | ((__ROL1__((v46 >> 1) & 0x55 | (2 * v46) & 0xAA, 5) ^ 4) << 16) | ((unsigned __int8)(__ROL1__(((unsigned __int8)((HIBYTE(*(_DWORD *)(packet + 24)) ^ 0xF2) + 9) >> 1) & 0x55 | (2 * ((HIBYTE(*(_DWORD *)(packet + 24)) ^ 0xF2) + 9)) & 0xAA, 5) ^ 4) << 24)).i64);
  ...
  return 1;
}
```

Tthe second parameter to `GetInternalObjectFromID` is the id that are the source and target network ids. The functions converts the network ids to the game engine objects by looking through a map of `[id -> object pointer]`. Then, to apply damage to the target object, there's a call to obj, using its vtable at offset `0x1920` to apply damage. The conversion using `_mm_cvtsi32_si128` just puts the bytes into the `xmm0` register because the function takes in a float.

</details>

The code can be boiled down to this

```cpp
void TakeDamage(__int64 idk, char* packet_buffer)
{
  target_object = GetInternalObjectFromID(DECRYPT_VALUE1((uint32_t)packet_buffer + 16));
  source_object = GetInternalObjectFromID(DECRYPT_VALUE2((uint32_t)packet_buffer + 36));

  target_object->take_damage(DECRYPT_FLOAT1((float)packet + 24));
}
```

`GetInternalObjectFromID` converts an id `(uint32_t)` to an internal object in the game. `DECRYPT_VALUE1` and `DECRYPT_VALUE2` are different inlined functions that decrypts a value that I'll explain in the next section.


Below is the an emulator for `GetInternalObjectFromID` for the `target object`. Feel free to try to it out. In the end, you should expect the value `265086324` in `RSI register`, which matches the second argument to `GetInternalObjectFromID`. `RDI` is the first argument, which is a global map of id -> object and `RSI` the is the second argument containing the network id.


{% include unicorn_emulator.html 
    id="demo1" 
    assembly="
mov    eax,DWORD PTR [rsi+0x10]
mov    esi,eax
shr    esi,0x8
mov    edx,eax
shr    edx,0x10
mov    ecx,eax
shr    ecx,0x18
rol    al,0x4
not    al
movzx  eax,al
lea    r15,[rip+0x18ccddb]
mov    al,BYTE PTR [rax+r15*1]
not    al
rol    al,0x4
add    al,0xca
movzx  eax,al
movzx  ebx,BYTE PTR [rax+r15*1]
imul   edi,ebx,0x8020
mov    eax,ebx
shl    eax,0xb
lea    eax,[rax+rbx*2]
and    eax,0x22110
and    edi,0x88440
or     edi,eax
imul   eax,edi,0x10101
rol    sil,0x4
not    sil
movzx  esi,sil
mov    bl,BYTE PTR [rsi+r15*1]
not    bl
rol    bl,0x4
shr    eax,0x10
add    bl,0xca
movzx  esi,bl
movzx  ebx,BYTE PTR [rsi+r15*1]
imul   edi,ebx,0x8020
mov    esi,ebx
shl    esi,0xb
lea    esi,[rsi+rbx*2]
and    esi,0x22110
and    edi,0x88440
or     edi,esi
rol    dl,0x4
imul   edi,edi,0x10101
not    dl
movzx  edx,dl
mov    dl,BYTE PTR [rdx+r15*1]
not    dl
rol    dl,0x4
add    dl,0xca
movzx  edx,dl
movzx  ebx,BYTE PTR [rdx+r15*1]
imul   edx,ebx,0x8020
mov    esi,ebx
shl    esi,0xb
lea    esi,[rsi+rbx*2]
and    esi,0x22110
and    edx,0x88440
or     edx,esi
rol    cl,0x4
not    cl
movzx  ecx,cl
mov    cl,BYTE PTR [rcx+r15*1]
not    cl
rol    cl,0x4
add    cl,0xca
movzx  ecx,cl
movzx  ebx,BYTE PTR [rcx+r15*1]
imul   esi,ebx,0x8020
mov    ecx,ebx
shl    ecx,0xb
lea    ecx,[rcx+rbx*2]
and    ecx,0x22110
and    esi,0x88440
or     esi,ecx
imul   ecx,esi,0x1010100
and    ecx,0xff000000
imul   edx,edx,0x10101
and    edx,0xff0000
shr    edi,0x8
and    edi,0xff00
movzx  esi,al
or     esi,edi
or     esi,edx
or     esi,ecx
mov    rdi,QWORD PTR [rip+0x1ba4332]
"
    registers="rax:0x20000,
rbx:0x100,
rcx:10,
rsi:0x10000,
r15:0x18cddfc
rip:0x1000"
    memory_view="0x10000"
    memory_raw="
0x10000:30 AE BE 01 01 00 00 00 07 01 16 78 00 40 9C 2B CB 1C DD 34 06 10 00 00 F5 FA D1 2B E9 E9 E9 E9 E5 49 00 00 F5 BA 3B F6 07 01 16 78 00 40 74 C8 73 E2 E8 CC 9E 71 F5 FA D1 2B E5 5B 3D 40 A6 FB,
0x18ccdfc:D7 56 82 DC 83 02 8F 29  35 04 21 71 79 9E 92 7F
CB 97 6A 51 05 C7 6F E6  40 63 7E 34 5B 47 07 78
5A 96 B8 B9 2C 99 5E 6E  D1 75 41 61 24 5F 4A AA
4B CF 0E D4 86 5D BA 1D  3F 2B DF 62 F0 33 00 55
CA FC 19 AC F3 66 23 69  BC EB 46 F8 9C 50 87 4D
6D 10 8E 88 BE 1B B5 DA  4E 1A 13 CC 22 09 AD A4
9D 30 A6 E5 7D FA C9 17  12 C2 FD E1 BB E7 0B 98
BF BD 11 37 C0 7C F7 95  B6 DD 49 F4 81 2A 9F 1C
FB 8D 9A 72 7B 57 7A 43  B3 A9 53 E4 59 20 2F A8
F6 74 36 A0 85 F1 A7 14  70 31 84 0C B2 A5 DB E8
16 AE 3D 25 B1 CD 9B 03  67 15 5C EA 1F 39 A1 44
0A 8B 76 DE 60 65 93 F2  64 D5 C1 C8 4C 06 4F B7
ED FE E0 F9 A2 18 48 91  CE 1E 3C B4 6C 42 54 94
E3 28 E9 01 27 EC 0D 45  FF 26 EF E2 8A AB D9 F5
08 C4 AF 32 C5 6B 80 C6  C3 58 EE A3 3E 2D 0F 89
3A B0 D2 D3 38 73 D8 D0  8C 77 90 52 3B D6 2E 68
"
%}

## How Does The Decryption Work

Let's break down this decompiled code: `target_object = GetInternalObjectFromID(DECRYPT_VALUE1((uint32_t)packet_buffer + 16));`? At first glance it's hard to read, so let's examine what's happening step by step:

```c
  v3 = *(_DWORD *)(packet + 16);
  v4 = HIWORD(v3);
  v5 = HIBYTE(v3);
  LOBYTE(v3) = __ROL1__(~byte_1019891E0[(unsigned __int8)~__ROL1__(v3, 4)], 4);
  v6 = byte_1019891E0[(unsigned __int8)(__ROL1__(
                                          ~byte_1019891E0[(unsigned __int8)~__ROL1__(BYTE1(*(_DWORD *)(packet + 16)), 4)],
                                          4)
                                      - 54)];
  v7 = 65793 * ((2050 * v6) & 0x22110 | (32800 * v6) & 0x88440);
  v8 = byte_1019891E0[(unsigned __int8)(__ROL1__(~byte_1019891E0[(unsigned __int8)~__ROL1__(v4, 4)], 4) - 54)];
  v9 = (2050 * v8) & 0x22110 | (32800 * v8) & 0x88440;
  v10 = byte_1019891E0[(unsigned __int8)(__ROL1__(~byte_1019891E0[(unsigned __int8)~__ROL1__(v5, 4)], 4) - 54)];
  target_object = GetInternalObjectFromID(
                    qword_101C60850,
                    (16843008 * ((2050 * v10) & 0x22110 | (32800 * v10) & 0x88440)) & 0xFF000000 | (65793 * v9) & 0xFF0000 | (v7 >> 8) & 0xFF00 | (unsigned __int8)((65793 * ((2050 * byte_1019891E0[(unsigned __int8)(v3 - 54)]) & 0x22110 | (32800 * byte_1019891E0[(unsigned __int8)(v3 - 54)]) & 0x88440u)) >> 16));
```

The decryption process uses a 255-byte lookup table combined with arithmetic operations. It's an enhanced version of XOR obfuscation: instead of a simple XOR, each byte goes through multiple transformations:

- Initial lookup in the 255-byte table
- Series of arithmetic operations (multiply, add, subtract)
- Additional table lookups
- Final transformation to produce the decrypted value

Boiling this down, it looks like this:

```c
  char lookup_table[255] = { 0x56, 0x82, 0xDC, 0x83, 0x02, 0x8F, 0x29, 0x35, 0x04, 0x21, 0x71, 0x79, 0x9E, 0x92, 0x7F, ... };
  uint32_t enc_data = *(uint32_t*)((char*)packet + 16);
  uint8_t lookup_byte1 = enc_data & 0xFF;
  uint8_t lookup_byte2 = (enc_data >> 8) & 0xFF;
  uint8_t lookup_byte3 = (enc_data >> 16) & 0xFF;

  // Here are the operations for 1 byte
  uint8_t lookup_byte3_intermediate = lookup_table[~lookup_byte3 >>= 4];
  // lookup again
  uint8_t value3 = lookup_table[lookup_byte3_intermediate];
  uint32_t transform_value3 = (16843008 * (2050 * value3) & 0x22110) | (value3 * 32800);
  // Extract the first byte out of it to place in our resulting value (network id)
  uint32_t high_byte = transform_value3 & 0xFF000000

  // Repeat for other bytes...

  uint32_t network_id = 0; // To fill in
  network_id |= high_byte;
```

Here's the emulator for taking damage `target_object->take_damage(DECRYPT_FLOAT1((float)packet + 24));` where performs the decryption and finally the damage value appears. At the end, you should get `000000003e874000` in `RAX` which is `0.26416015625`

{% include unicorn_emulator.html 
    id="demo2" 
    assembly="
mov     eax, [r13+18h]
mov     ecx, eax
xor     cl, 0F2h
add     cl, 9
mov     edx, ecx
shr     dl, 1
and     dl, 55h
add     cl, cl
and     cl, 0AAh
or      cl, dl
rol     cl, 5
xor     cl, 4
movzx   ecx, cl
mov     edx, eax
shr     edx, 8
xor     dl, 0F2h
add     dl, 9
mov     ebx, edx
shr     bl, 1
and     bl, 55h
add     dl, dl
and     dl, 0AAh
or      dl, bl
rol     dl, 5
xor     dl, 4
movzx   edx, dl
shl     edx, 8
or      edx, ecx
mov     ecx, eax
shr     ecx, 10h
xor     cl, 0F2h
add     cl, 9
mov     ebx, ecx
shr     bl, 1
and     bl, 55h
add     cl, cl
and     cl, 0AAh
or      cl, bl
rol     cl, 5
xor     cl, 4
movzx   ecx, cl
shl     ecx, 10h
or      ecx, edx
shr     eax, 18h
xor     al, 0F2h
add     al, 9
mov     edx, eax
shr     dl, 1
and     dl, 55h
add     al, al
and     al, 0AAh
or      al, dl
rol     al, 5
xor     al, 4
movzx   eax, al
shl     eax, 18h
or      eax, ecx
movd    xmm0, eax
"
    registers="rax:0x20000,
rbx:0x100,
rcx:10,
rsi:0x10000,
r13:0x10000,
rip:0x1000"
    memory_view="0x10000"
    memory_raw="
0x10000:30 AE BE 01 01 00 00 00 07 01 16 78 00 40 9C 2B CB 1C DD 34 06 10 00 00 F5 FA D1 2B E9 E9 E9 E9 E5 49 00 00 F5 BA 3B F6 07 01 16 78 00 40 74 C8 73 E2 E8 CC 9E 71 F5 FA D1 2B E5 5B 3D 40 A6 FB,
0x18ccdfc:D7 56 82 DC 83 02 8F 29  35 04 21 71 79 9E 92 7F
CB 97 6A 51 05 C7 6F E6  40 63 7E 34 5B 47 07 78
5A 96 B8 B9 2C 99 5E 6E  D1 75 41 61 24 5F 4A AA
4B CF 0E D4 86 5D BA 1D  3F 2B DF 62 F0 33 00 55
CA FC 19 AC F3 66 23 69  BC EB 46 F8 9C 50 87 4D
6D 10 8E 88 BE 1B B5 DA  4E 1A 13 CC 22 09 AD A4
9D 30 A6 E5 7D FA C9 17  12 C2 FD E1 BB E7 0B 98
BF BD 11 37 C0 7C F7 95  B6 DD 49 F4 81 2A 9F 1C
FB 8D 9A 72 7B 57 7A 43  B3 A9 53 E4 59 20 2F A8
F6 74 36 A0 85 F1 A7 14  70 31 84 0C B2 A5 DB E8
16 AE 3D 25 B1 CD 9B 03  67 15 5C EA 1F 39 A1 44
0A 8B 76 DE 60 65 93 F2  64 D5 C1 C8 4C 06 4F B7
ED FE E0 F9 A2 18 48 91  CE 1E 3C B4 6C 42 54 94
E3 28 E9 01 27 EC 0D 45  FF 26 EF E2 8A AB D9 F5
08 C4 AF 32 C5 6B 80 C6  C3 58 EE A3 3E 2D 0F 89
3A B0 D2 D3 38 73 D8 D0  8C 77 90 52 3B D6 2E 68
"
%}

## So what's the catch?

While it might seem feasible to reimplement these functions in Python without running the client, several factors make this approach impractical<span class="sidenote-ref"></span><span class="sidenote">Actually, a more seasoned reverse engineer may know better tools for doing such things.</span>:

- the encryption and decryption methods changes
  - lookup table might be different
  - the operations after the lookup might be different
  - there's not a single global lookup table
    - a different lookup table associated with every function
- the chunk layout (fields) get shuffled per patch
  - What may be in 0x10 offset of the packet may now be at offset 0x38
- the packet types switch up each patch

## "Beating" The Obfuscation

Instead of reverse-engineering each encryption function, I chose a pragmatic approach: reading values directly from registers. This method requires an emulator, which typically runs rather slow ([unicorn emulator](https://github.com/unicorn-engine/unicorn)). Instead, I developed an "exception emulator" that runs natively (detailed in the [performance section](#performance)).

For example, in the TakeDamage function, I intercept two key values:
- The network id from the RSI register before target_object creation
- The damage value from RAX before it's applied

This interception uses a trampoline hook<span class="sidenote-ref"></span><span class="sidenote">If you're not familiar with trampoline hook, it's essentially a callback that you add or similar to breakpointing in gdb and editing the program's variables before continuing</span>:

{% include image.html path="/assets/images/posts/2024-11-02/hooking.png" width="85%" text="Visually demonstrating what a trampoline hook does" url_source="https://www.codereversing.com/archives/593" url_text="codereversing.com"%}

<details markdown="1" style="font-size: 1.2em; margin: 1em 0;">
<summary style="cursor: pointer; font-weight: bold;">Click to expand to view how the trampoline hook works</summary>

The process has two parts:

Save original bytes and insert jump:

```nasm
movd xmm0,eax
jmp FFF90000 # Insert my trampoline hook here
```

Create trampoline:
- Save all register states
- Call `MY_FUNCTION` to expose registers as a struct
- Allow high-level language access to register values
- Restore registers
- Execute original instructions
- Return to normal code flow

```nasm
push rsp                               
pushfq                                 
...     
push r8                                
push r9                                
push r10                               
push r11                               
push r12                               
push r13                               
push r14                               
push r15                               
push rbx                               
push rcx                               
push rdx                               
push rsi                               
push rdi                               
push rbp                               
sub rsp,40                             
movaps xmmword ptr ss:[rsp],xmm0       
movaps xmmword ptr ss:[rsp+10],xmm1    
movaps xmmword ptr ss:[rsp+20],xmm2    
movaps xmmword ptr ss:[rsp+30],xmm3    
...
mov rax, MY_FUNCTION # This is what we redirect to, to read RAX
call rax                               
...
movaps xmm0,xmmword ptr ss:[rsp]       
movaps xmm1,xmmword ptr ss:[rsp+10]    
movaps xmm2,xmmword ptr ss:[rsp+20]    
movaps xmm3,xmmword ptr ss:[rsp+30]    
add rsp,40                             
pop rbp                                
pop rdi                                
pop rsi                                
pop rdx                                
pop rcx                                
pop rbx                                
pop r15                                
pop r14                                
pop r13                                
pop r12                                
pop r11                                
pop r10                                
pop r9                                 
pop r8                      
...            # Execute original function somewhere here        
jmp qword ptr ds:[FFF90105] 
xchg esp,eax                           
ret far        # Jump back
```

</details>

At the high level, Rust code interfaces with these hooks to read and modify program state:

```rust
emulator.hook_address(TakeDamageAddress, move |emulator, context| {
    let damage_float = convert_xmm_to_float(context.xmm0);
    obj.take_damage(damage_float);
});
```

By applying similar hooks to other game events (ability casts, movement, resource changes, etc.), we can reconstruct the complete gameplay state.

## Why do it this way?

- Works directly with compressed ROFL files
- Uses fewer resources than running the game
  - Ignores irrelevant game systems
- Provides precise value extraction

## Why not do it this way?

- Requires hooking undocumented packet structures
  - Have deep understanding of packet structures
- System breaks with unexpected packet changes
- Potential for value extraction errors
- No game engine validation

## Alternative Approach: Direct Game State Reading

[MiscellaneousStuff](https://github.com/MiscellaneousStuff/tlol-scraper-pandoras)'s approach avoids packet analysis entirely by reading game state directly:
{% include image.html path="https://miscellaneousstuff.github.io/assets/arch/tlol-replay-scraping-arch.svg" width="50%" text="Replay extraction by running the game and reading game state per interval" url_source="https://miscellaneousstuff.github.io/project/2021/11/19/tlol-part-6-dataset-generation.html" url_text="miscellaneousstuff.github.io"%}

This method works by running the full game client (sound, graphics, network, etc) in replay mode, sampling the game at fixed time intervals and dumping the game state snapshots to disk.

While simpler to maintain, this sampling approach trades precision for simplicity. Lower sampling intervals increase precision but increases data usage, similar to [sample-based profilers](https://stackoverflow.com/questions/40305096/difference-between-android-trace-based-and-sampling-based-method-profiling-and-i).

# Performance

Since we're scraping, perfomance matters a little bit. We don't want it to be running at a snail's pace (hours+ per replay). 

I've written the emulator originally with the [unicorn emulator](https://github.com/unicorn-engine/unicorn)<span class="sidenote-ref"></span><span class="sidenote">If you're unfamiliar with unicorn emulator, it's a CPU emulator. I like to think of it as GDB with much more powerful scripting capabilities</span> in python. It was a good for bootstrapping, but it was terribly slow (by how much? somewhere like 5 minutes per replay).

I've since rewritten it in rust with an api similar to unicorn emulator's api. I called it the `exception emulator` because it runs natively and any exceptions (ex, out of bounds memory accesses) are routed and handled by a hook similar to unicorn's api. It works by inserting a software breakpoint ([INT3 instruction on x86 CPUs](https://en.wikipedia.org/wiki/INT_(x86_instruction))) and creating an exception handler that lookups the corresponding the function to call that is mapped to the breakpoint. I use this to reverse functions where the game state is not properly initialized.

My very simple methodology for evaluating my program using a single replay with a machine setup:

- Input:
  - ~15 minute replay (11.5mb rofl file)
  - "Gaming" machine
  - NVME device
  - Windows 11
  - Other applications are running like chrome and discord
- Output:
  - prettified json ~(135MB)

```
PS> Measure-Command {start-process cargo "run --release -- -file test.rofl" -Wait}


Days              : 0
Hours             : 0
Minutes           : 0
Seconds           : 3
Milliseconds      : 33
Ticks             : 30338426
TotalDays         : 3.51139189814815E-05
TotalHours        : 0.000842734055555556
TotalMinutes      : 0.0505640433333333
TotalSeconds      : 3.0338426
TotalMilliseconds : 3033.8426
```

Running with one replay of ~15 minutes finishes in 3 seconds. Eyeballing task manager, it takes around 400MB up when running. Output is 135MB of prettified json.

## Comparison to MiscellaneousStuff's approach

Author also does some napkin math ~ [`26 / 16 + 0.25`](https://miscellaneousstuff.github.io/project/2021/11/19/tlol-part-6-dataset-generation.html) = 1.6 minutes = 96 seconds for 26 minute replay. So accounting for the replay, I'm running at 5 seconds, which is a bit faster than the author's approach. The memory might bit a bit higher (running the game), which I've eyeballed at 1GB. Space utilization is ~820MB unpacking one game from [his repo](https://github.com/MiscellaneousStuff/tlol/blob/main/EUW1-5270795542.rofl.7z) compared to 300MB - 500MB.

While this does show that my approach has better performance, this is definitely eyeballing the results. I haven't ran the author's code.

In either case, both should scale decently. Both can run multiple instances of the game/emulator.

# Other Tidbits

## Packet Optimizations

If you are working at RIOT, I've listed some optimizations that could be applied to the packets. I don't have a full view of how the game engine/server works, so some of these optimizations may not apply.

### Repeat Packets

Packets of leaving the fog appear multiple times (20+ repeats sometimes!) at the same time for the same id. I don't see why this should be done unless there's an engine specific issue or an issue when generating a replay.

```json
{
  "LeaveFromFog": {
    "time": 862.4249,
    "id": 1073741859
  }
}
```

A look into a single replay file shows the following:

```sh
Repeat packets: 21762
Total packets: 770650
Percentage of repeat packets: 2.82%
Repeat packet total bytes: 65370
Packet total bytes: 3399813
Percentage of bytes used up by repeat packets: 1.92%
```

{% include image.html path="/assets/images/posts/2024-11-02/repeat_packets.png" width="100%" text="A graph showing the breakdown of repeat packets per packet type"%}

Removing these repeats in the replay could reduce the amount of data used per replay by around ~2%, which could save cost for hosting the space and bandwidth saved using the cloud (perhaps AWS).

Doing some quick estimates only for storage writes cost

[~30 million active players per day](https://turbosmurfs.gg/article/league-of-legends-player-count-and-statistics) and a player plays at least 2 games per day

```
average replay size = 10MB = 10 MB
optimization = 0.02
daily active users = 30 million / day = 30M/day
number of games = daily active users × 2 / 10 = 6M/day
data written in a day = number of games × average replay size to GB/day = 60,000 GB/day
data saved = optimization × data written in a day = 1,200 GB/day
aws S3 cost = $0.02 per GB  = $0.02/GB
money saved per day = data saved × aws S3 cost = $24.00/day
money saved per day per month = $730.49
money saved per day per year = $8,765.82
```

### Integer Values

For integer values (ids, hashes, etc), consider using [variable integer compression](hhttps://en.wikipedia.org/wiki/LEB128), which is commonly used in serialization frameworks such as [protobuf](https://github.com/protocolbuffers/protobuf) and [wasm](https://webassembly.github.io/spec/core/binary/values.html) to save more space.

The chunk format already does this for single byte versus 4 byte integer, the variable integer compression can be used to create 2 byte or 3 byte integers.

### Same-ish Packets

Some packets have different ids, but mostly do the same thing <span class="sidenote-ref"></span><span class="sidenote">For example, there could be a MovementPacket1 and MovementPacket2, and they both have the same fields, except for 1 or 2 extra fields in MovementPacket2</span>. I believe that merging them could reduce complexity, but I do not know how the game server is structured or how the code base is structured

### Repeat of Different Packets

Some packets encompass the same meaning. For example, typically, a damage packet is applied (by the same id) followed by a death packet at the same time. The damage packet is not necessary. However, due to the game engine and the way it is structured, it may be difficult to remove this.

### Replay Time offset

An optimization I observed for each packet is using a byte (instead of a float) to represent the time offset for the next packet. This is quite neat.

## Game Engine Optimizations

I'm going to suggest some game engine optimizations below. However, consider that the game engine itself is quite old, it may be difficult to near impossible to change how the engine is structured.

### Single Threadedness

Packets are handled as follows:

```
Create/Allocate packet -> Deserialize buffer into packet -> Update game state with packet
```

Instead, multiple threads could be used to split the work

```
Thread 1: Create/Allocate packet -> Deserialize buffer into packet
Thread 2: Create/Allocate packet -> Deserialize buffer into packet
Thread 3: Create/Allocate packet -> Deserialize buffer into packet
Thread 4: Create/Allocate packet -> Deserialize buffer into packet

Thread 5: Update game state with packet
```

The packets may be out of order, so have another thread order the packets with queues:

```
Thread 1: Create/Allocate packet -> Deserialize buffer into packet -> Unordered packet queue
Thread 2: Create/Allocate packet -> Deserialize buffer into packet -> Unordered packet queue
Thread 3: Create/Allocate packet -> Deserialize buffer into packet -> Unordered packet queue
Thread 4: Create/Allocate packet -> Deserialize buffer into packet -> Unordered packet queue

Thread 6: Unordered packet queue -> Order packets -> Ordered packet queue

Thread 5: Ordered Packet queue -> Update game state with packet
```

### Buffer Pools

Instead of allocating/freeing memory for each packet, use a buffer/memory pool for commonly used packets to reduce CPU overhead.

# Thoughts

## Improvements

One idea is to lift the assembly to LLVM, perform static analysis to generate or extract the decryption mechanism or the functions themselves into a different language such as C++, but that would take way too much time.

Lastly, the bottleneck in the system is most likely replay aggregation (which I haven't measure yet, but I would assume so given that downloading the replay takes seconds).

## Wrapping Up

Fun project. Captured hundred of thousands of replays and did some analysis on them, but got busy. Learned a bit more about reversing and rust.
<<<<<<< HEAD

# Dataset

Released over 1.4M league replays on huggingface (with detailed network level packet data). You can find them here: [700K+ dataset](https://huggingface.co/datasets/maknee/league-of-legends-decoded-replay-packets) and the other [700K+ dataset](https://huggingface.co/datasets/maknee/leaague-of-legends-decoded-replay-packets-s12-unorganized)
=======
>>>>>>> fa2ce74f925588009360fae64567a5ea4be6c68d
