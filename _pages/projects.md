---
layout: page
title: projects
title2: Projects
permalink: /projects/
description: Projects I've created :)
---

{% assign sorted_projects = site.projects | sort: 'rank' | reverse %}
{% for project in sorted_projects %}

{% if project.redirect %}
<div class="project">
    <div class="thumbnail">
        <a href="{{ project.redirect }}" target="_blank">
        {% if project.thumbnail %}
        <img class="thumbnail" src="{{ project.thumbnail | prepend: site.baseurl | prepend: site.url }}"/>
        {% else %}
        <div class="thumbnail blankbox"></div>
        {% endif %}    
        <span>
            <h1>{{ project.title }}</h1>
            <br/>
            <p>{{ project.summary }}</p>
        </span>
        </a>
    </div>
</div>
{% else %}

<div class="project ">
    <div class="thumbnail">
        <a href="{{ project.url | prepend: site.baseurl | prepend: site.url }}">
        {% if project.thumbnail %}
        <img class="thumbnail" src="{{ project.thumbnail | prepend: site.baseurl | prepend: site.url }}"/>
        {% else %}
        <div class="thumbnail blankbox"></div>
        {% endif %}    
        <span>
            <h1>{{ project.title }}</h1>
            <br/>
            <p>{{ project.summary }}</p>
        </span>
        </a>
    </div>
</div>

{% endif %}

{% endfor %}
