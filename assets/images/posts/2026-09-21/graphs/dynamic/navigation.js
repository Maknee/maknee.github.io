/* TOC adapted from _includes/post_rail.html; used only by the final checkpointing post. */
document.addEventListener('DOMContentLoaded', function () {
  var rail = document.getElementById('post-rail');
  var list = document.getElementById('post-rail-list');
  var toggle = document.getElementById('post-rail-toggle');
  var content = document.getElementById('markdown-content');
  if (!content) return;

  // In-page jumps (TOC, overview chart, any #link): trace previews and lazy images above the target
  // grow after the jump and push the heading down, so keep it aligned under the navbar until the
  // layout settles or the reader takes over.
  var holding = false;
  (function () {
    if (!('ResizeObserver' in window)) return;
    var target = null, until = 0, cap = 0, ro = null, timer = null;
    var STOP_ON = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
    function align() {
      if (!target) return;
      var now = Date.now();
      if (now > until) { stop(); return; }
      var margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
      var dy = target.getBoundingClientRect().top - margin;
      if (Math.abs(dy) > 1) window.scrollBy(0, dy);
      // Keep holding while things are still loading, up to the cap.
      until = Math.min(cap, Math.max(until, now + 1500));
      clearTimeout(timer);
      timer = setTimeout(stop, until - now + 50);
    }
    function stop() {
      target = null;
      holding = false;
      clearTimeout(timer);
      if (ro) { ro.disconnect(); ro = null; }
      for (var i = 0; i < STOP_ON.length; i++) window.removeEventListener(STOP_ON[i], stop, true);
    }
    function hold(hash, ms) {
      var id = hash && hash.charAt(0) === '#' ? hash.slice(1) : '';
      try { id = decodeURIComponent(id); } catch (e) { /* keep the raw id */ }
      var t = id && document.getElementById(id);
      if (!t) return;
      stop();
      target = t;
      holding = true;
      var now = Date.now();
      until = now + ms;
      cap = now + 8000;
      for (var i = 0; i < STOP_ON.length; i++) window.addEventListener(STOP_ON[i], stop, { capture: true, passive: true });
      ro = new ResizeObserver(align);
      ro.observe(content);
      timer = setTimeout(stop, ms + 50);
      requestAnimationFrame(align);
    }
    document.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a') : null;
      var href = a ? a.getAttribute('href') || a.getAttribute('xlink:href') : null;
      if (!href || href.length < 2 || href.charAt(0) !== '#' || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      // After the browser's own jump (and only if no other handler cancelled it).
      setTimeout(function () {
        if (e.defaultPrevented) return;
        hold(href, 3000);
        if (a.closest('.post-rail, #checkpoint-overview, #gvisor-overview')) {
          var destination = document.getElementById(decodeURIComponent(href.slice(1)));
          if (destination) {
            if (!destination.hasAttribute('tabindex')) {
              destination.setAttribute('tabindex', '-1');
              destination.addEventListener('blur', function () { destination.removeAttribute('tabindex'); }, { once: true });
            }
            destination.focus({ preventScroll: true });
          }
        }
      }, 0);
    });
    window.addEventListener('hashchange', function () { hold(location.hash, 3000); });
    if (location.hash) hold(location.hash, 5000);
  })();

  if (!rail || !list || !toggle) return;
  var heads = content.querySelectorAll('h1[id], h2[id], h3[id]');
  var links = [];
  var parents = [];
  var panel = false;
  for (var i = 0; i < heads.length; i++) {
    var h = heads[i];
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.href = '#' + h.id;
    a.textContent = h.textContent;
    li.appendChild(a);
    var level = Number(h.tagName.slice(1));
    while (parents.length && parents[parents.length - 1].level >= level) parents.pop();
    var parent = parents.length ? parents[parents.length - 1].item : null;
    var children = parent ? parent.querySelector(':scope > ol') : list;
    if (!children) { children = document.createElement('ol'); parent.appendChild(children); }
    children.appendChild(li);
    parents.push({ level: level, item: li });
    links.push({ head: h, link: a, item: li });
  }
  function setOpen(open) {
    rail.hidden = !open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    // Show the current section when the panel opens.
    var on = open && panel ? list.querySelector('a.is-active') : null;
    if (on) rail.scrollTop = Math.max(0, on.offsetTop - rail.clientHeight / 3);
  }
  // Keeps a 16 px gutter from the window edge. Only a switch into panel mode closes the panel, so the
  // resize events fired by a mobile URL bar showing or hiding leave an open panel alone.
  var placed = false;
  function place() {
    var box = content.getBoundingClientRect();
    var room = box.left - 40 - 16;
    var wasPanel = panel;
    panel = room < 160;
    rail.classList.toggle('is-panel', panel);
    toggle.hidden = !panel;
    if (panel) {
      rail.style.left = '';
      rail.style.width = '';
      if (!placed || !wasPanel) setOpen(false);
      placed = true;
      return;
    }
    placed = true;
    var w = Math.min(220, room);
    rail.hidden = false;
    rail.style.width = w + 'px';
    rail.style.left = Math.round(Math.max(16, box.left - w - 40)) + 'px';
  }
  var activeItem = null;
  function activate() {
    var pick = null;
    for (var i = 0; i < links.length; i++) {
      var margin = parseFloat(getComputedStyle(links[i].head).scrollMarginTop) || 0;
      if (links[i].head.getBoundingClientRect().top <= margin + 2) pick = links[i];
    }
    for (var j = 0; j < links.length; j++) {
      links[j].link.classList.toggle('is-active', links[j] === pick);
      if (links[j] === pick) links[j].link.setAttribute('aria-current', 'location');
      else links[j].link.removeAttribute('aria-current');
      links[j].item.classList.remove('is-open');
    }
    var open = pick ? pick.item : null;
    while (open && open !== list) {
      if (open.tagName === 'LI') open.classList.add('is-open');
      open = open.parentElement;
    }
    if (pick && pick !== activeItem && !rail.hidden) {
      var itemBox = pick.link.getBoundingClientRect();
      var railBox = rail.getBoundingClientRect();
      if (itemBox.top < railBox.top + 8) rail.scrollTop += itemBox.top - railBox.top - 8;
      else if (itemBox.bottom > railBox.bottom - 8) rail.scrollTop += itemBox.bottom - railBox.bottom + 8;
    }
    activeItem = pick;
  }
  toggle.addEventListener('click', function (e) {
    e.stopPropagation();
    var opening = rail.hidden;
    setOpen(opening);
    if (opening) {
      var first = list.querySelector('a.is-active') || list.querySelector('a');
      if (first) first.focus({ preventScroll: true });
    }
  });
  list.addEventListener('click', function (e) {
    if (panel && e.target.closest('a')) setOpen(false);
  });
  // pointerdown rather than click: iOS Safari sends no click for taps on plain text.
  document.addEventListener('pointerdown', function (e) {
    if (panel && !rail.hidden && !rail.contains(e.target) && !toggle.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', function (e) {
    if (panel && e.key === 'Escape' && !rail.hidden) { setOpen(false); toggle.focus({ preventScroll: true }); }
  });
  // Tuck the Contents button away while reading down; scrolling up (or near the top) shows it again.
  // Jumps (a link, or the alignment hold above) and an open panel leave it alone.
  var lastY = window.scrollY;
  function tuck() {
    var y = window.scrollY, dy = y - lastY;
    if (!panel || !rail.hidden || document.activeElement === toggle || holding || Math.abs(dy) > window.innerHeight || y < 200) toggle.classList.remove('is-tucked');
    else if (dy > 4) toggle.classList.add('is-tucked');
    else if (dy < -4) toggle.classList.remove('is-tucked');
    if (Math.abs(dy) > 4 || holding) lastY = y;
  }
  window.addEventListener('scroll', function () { activate(); tuck(); }, { passive: true });
  window.addEventListener('resize', function () { place(); activate(); });
  if ('ResizeObserver' in window) new ResizeObserver(function () { place(); activate(); }).observe(content);
  place();
  activate();
});

// Add links to the published charts. Geometry and displayed measurements come
// from each SVG; these mappings contain section destinations only.
document.addEventListener('DOMContentLoaded', function () {
  linkOverview('checkpoint-overview', 'matplotlib', [
    ['Stock', 'whats-happening-in-cuda-checkpoint', 'Stock checkpoint and restore'],
    ['cli opt', 'rewriting-the-cli', 'CLI optimization'],
    ['+ huge pages', 'huge-pages', 'Huge pages'],
    ['+prealloc', 'minimizing-page-faults', 'Preallocation'],
    ['+ NUMA policy', 'numa-policy', 'NUMA policy'],
    ['+ staging workers', 'parallelizing-the-copy', 'Staging workers'],
    ['+ staging slots', 'staging-buffer-count', 'Staging buffers'],
    ['+ NUMA-aware same node', 'becoming-numa-aware', 'NUMA-aware placement'],
    ['+ PCIe split', 'becoming-pcie-link-aware', 'Independent PCIe links'],
    ['+ streaming copy', 'streaming-stores', 'Streaming stores'],
    ['+ direct pinned', 'removing-the-staging-buffers', 'Direct pinned copy']
  ]);
  linkOverview('gvisor-overview', 'gvisor', [
    ['Stock', 'where-gvisor-spends-the-time', 'Stock gVisor checkpoint and restore'],
    ['Opt CUDA', 'seeing-cuda-checkpoint-optimizations-in-action', 'Optimized CUDA in gVisor'],
    ['Stock + direct I/O', 'getting-the-checkpoint-onto-storage-faster', 'Direct I/O with stock CUDA'],
    ['Opt CUDA + direct I/O', 'getting-the-checkpoint-onto-storage-faster', 'Direct I/O with optimized CUDA'],
    ['Stock + Parallel Streams', 'parallel-cpugpu-streams', 'Parallel streams with stock CUDA'],
    ['Opt CUDA + parallel stream', 'parallel-cpugpu-streams', 'Parallel streams with optimized CUDA'],
    ['Opt CUDA + parallel stream + background restore', 'starting-gpu-restore-before-all-pages-arrive', 'Background restore']
  ]);

  async function linkOverview(containerId, format, steps) {
    var container = document.getElementById(containerId);
    var img = container && container.querySelector('img');
    if (!img) return;
    function normalized(value) { return value.replace(/\s+/g, '').toLowerCase(); }
    try {
      var response = await fetch(img.src);
      if (!response.ok) throw new Error('Overview SVG: HTTP ' + response.status);
      var parsed = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
      if (parsed.querySelector('parsererror')) throw new Error('Invalid overview SVG');
      var svg = document.importNode(parsed.documentElement, true);
      var bars = steps.map(function (_, i) {
        return svg.querySelector(format === 'gvisor'
          ? '#total-configuration-' + (i + 1) + ' rect[data-measurement="checkpoint-plus-restore"]'
          : '#patch_' + (i + 4) + ' path');
      });
      var ticks = steps.map(function (_, i) {
        return svg.querySelector(format === 'gvisor' ? '#total-configuration-' + (i + 1) : '#xtick_' + (i + 1));
      });
      steps.forEach(function (step, i) {
        var title = ticks[i] && ticks[i].querySelector('title');
        var name = format === 'gvisor' ? title && title.textContent
          : ticks[i] && Array.from(ticks[i].querySelectorAll('text')).map(function (t) { return t.textContent; }).join(' ');
        if (!bars[i] || normalized(name || '') !== normalized(step[0]) || !document.getElementById(step[1])) {
          throw new Error('Overview section mapping does not match: ' + step[2]);
        }
      });
      // Matplotlib IDs and its universal CSS rule must not affect other figures.
      var prefix = containerId + '-';
      svg.querySelectorAll('[id]').forEach(function (el) { el.id = prefix + el.id; });
      svg.querySelectorAll('*').forEach(function (el) {
        Array.from(el.attributes).forEach(function (attr) {
          var value = attr.value.replace(/url\(#([^\)]+)\)/g, 'url(#' + prefix + '$1)');
          if ((attr.localName === 'href') && value.charAt(0) === '#') value = '#' + prefix + value.slice(1);
          if (value !== attr.value) el.setAttributeNS(attr.namespaceURI, attr.name, value);
        });
      });
      svg.id = containerId + '-svg';
      svg.querySelectorAll('style').forEach(function (style) {
        style.textContent = style.textContent.replace(/\*\s*\{/g, '#' + svg.id + ' *{');
      });
      svg.setAttribute('role', 'group');
      svg.setAttribute('aria-label', 'Optimization results. Each column links to its explanation.');
      var plot = document.createElement('div');
      plot.className = 'checkpoint-overview-plot';
      img.replaceWith(plot);
      plot.appendChild(svg);
      await document.fonts.ready;
      var bounds = bars.map(function (bar) { return bar.getBBox(); });
      var centers = bounds.map(function (box) { return box.x + box.width / 2; });
      var bottom = Math.max.apply(null, ticks.map(function (tick) { var box = tick.getBBox(); return box.y + box.height; })) + 8;
      var top = svg.viewBox.baseVal.y + 8;
      steps.forEach(function (step, i) {
        var x1 = i ? (centers[i - 1] + centers[i]) / 2 : centers[i] - (centers[i + 1] - centers[i]) / 2;
        var x2 = i + 1 < centers.length ? (centers[i] + centers[i + 1]) / 2 : centers[i] + (centers[i] - centers[i - 1]) / 2;
        var link = document.createElementNS(svg.namespaceURI, 'a');
        link.setAttribute('href', '#' + step[1]);
        link.setAttribute('class', 'checkpoint-step');
        link.setAttribute('tabindex', '0');
        link.setAttribute('aria-label', 'Read about ' + step[2]);
        var title = document.createElementNS(svg.namespaceURI, 'title');
        title.textContent = 'Jump to ' + step[2];
        link.appendChild(title);
        var rect = document.createElementNS(svg.namespaceURI, 'rect');
        [['x', x1 + 1], ['y', top], ['width', x2 - x1 - 2], ['height', bottom - top], ['rx', 3]].forEach(function (a) { rect.setAttribute(a[0], a[1]); });
        link.appendChild(rect);
        svg.appendChild(link);
      });
      var cue = document.createElement('p');
      cue.className = 'checkpoint-overview-cue';
      cue.textContent = 'Click a bar to jump to its section.';
      var mobile = document.createElement('span');
      mobile.className = 'checkpoint-overview-mobile';
      mobile.textContent = ' Swipe to see all bars.';
      cue.appendChild(mobile);
      plot.before(cue);
    } catch (error) {
      // The original chart remains usable if the enhancement cannot load.
      if (typeof plot !== 'undefined' && plot && plot.isConnected) plot.replaceWith(img);
      console.warn(error);
    }
  }
});
