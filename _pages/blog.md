---
layout: default
permalink: /blog/
title: blog
nav: true
nav_order: 1
pagination:
  enabled: false
  collection: posts
  permalink: /page/:num/
  per_page: 1000
  sort_field: date
  sort_reverse: true
  trail:
    before: 1 # The number of links before the current page
    after: 3 # The number of links after the current page
---
{%- comment -%}
Original blog index with featured cards + post list has been commented out to keep the page lean.
{%- endcomment -%}

<div class="post">
  <header class="post-header">
    <h1 class="post-title">Blog</h1>
  </header>

  <!-- Curated sections on top -->
  {% include blog_preamble.liquid %}

  <!-- Lean archive-style index grouped by year (inspired by thume.ca/archive.html) -->
  {% include blog_archive.liquid %}
</div>
