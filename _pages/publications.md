---
layout: page
permalink: /publications/
title: publications
title2: Publications
description: Publications I've worked on!
years: [2019, 2018]
---

{% for y in page.years %}
  <h3 class="year">{{y}}</h3>
  {% bibliography -f papers -q @*[year={{y}}]* %}
{% endfor %}
