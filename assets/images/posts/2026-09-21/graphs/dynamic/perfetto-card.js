/* Perfetto trace cards with optional previews. Used by _includes/perfetto_trace_card.html.
 *
 * Card actions
 *   Open in Perfetto  new tab. On a public host the tab loads the trace by URL and zooms to the
 *                     preview window (visStart / visEnd). On localhost it pushes the trace with
 *                     postMessage instead, because ui.perfetto.dev cannot fetch from localhost.
 *   Load here         replaces the preview with the embedded viewer (postMessage handshake).
 *   Preview eye       remembers your choice; defaults on for desktop and off for mobile.
 * Preview
 *   A JSON file (TMP_GRAPHING/final/trace_previews/build_previews.py) with lanes of spans, counter
 *   series and key metrics. Rendered as SVG when the card nears the viewport. Hover shows the
 *   phase and values at that time; click opens that window in Perfetto. On touch, a tap or drag
 *   shows the values and a second tap opens Perfetto. Below 760 px the preview draws at 1:1 CSS pixels.
 */
(function () {
  'use strict';
  if (window.__perfettoCards) { window.__perfettoCards.scan(); return; }

  var PERFETTO = 'https://ui.perfetto.dev';
  var HANDSHAKE_TIMEOUT_MS = 30000;
  var AUTOLOAD_KEY = 'perfetto-trace-autoload';
  var AUTOLOAD_EVENT = 'perfetto-trace-autoload-change';
  var PREVIEW_KEY = 'perfetto-show-previews';
  var PREVIEW_EVENT = 'perfetto-show-previews-change';
  var showPreviews = readPreviewPreference();
  var SVGNS = 'http://www.w3.org/2000/svg';
  var precisionUrl = new URL('preview-precision.json', document.currentScript.src);
  var precisionPromise;

  // The shared previews were rounded before display. Recover the few durations
  // where that would change a ceiling to 0.1 s, without rewriting shared data.
  function precisePreview(data) {
    if (!precisionPromise) precisionPromise = fetch(precisionUrl).then(function (r) {
      if (!r.ok) throw new Error('Preview precision: HTTP ' + r.status);
      return r.json();
    });
    return precisionPromise.then(function (values) {
      var entry = values[data.trace];
      if (!entry) return data;
      entry.metrics.forEach(function (value) {
        (data.metrics || []).forEach(function (metric) {
          if (metric.label === value.label && metric.value === value.stored_seconds) metric.value = value.exact_seconds;
        });
      });
      entry.segments.forEach(function (value) {
        (data.lanes || []).forEach(function (lane) {
          if (lane.label !== value.lane) return;
          lane.segments.forEach(function (segment) {
            if (segment.name === value.name && segment.start === value.start && segment.dur === value.stored_seconds) segment.dur = value.exact_seconds;
          });
        });
      });
      return data;
    }).catch(function (err) { console.warn(err); return data; });
  }

  function isLocalHost() {
    return location.protocol === 'file:' || /^(localhost|127\.|0\.0\.0\.0|\[::1\]|192\.168\.|10\.)/.test(location.hostname);
  }
  function readAutoload() { try { return localStorage.getItem(AUTOLOAD_KEY) === '1'; } catch (e) { return false; } }
  function writeAutoload(on) { try { localStorage.setItem(AUTOLOAD_KEY, on ? '1' : '0'); } catch (e) { /* private mode */ } }
  function readPreviewPreference() {
    try {
      var saved = localStorage.getItem(PREVIEW_KEY);
      if (saved === '1' || saved === '0') return saved === '1';
    } catch (e) { /* Use the device default if storage is unavailable. */ }
    return !window.matchMedia('(max-width: 640px), (pointer: coarse)').matches;
  }
  function writePreviewPreference(on) { try { localStorage.setItem(PREVIEW_KEY, on ? '1' : '0'); } catch (e) { /* private mode */ } }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function whenNear(el, margin, fn) {
    if (!('IntersectionObserver' in window)) { fn(); return; }
    var io = new IntersectionObserver(function (entries) {
      if (!entries.some(function (e) { return e.isIntersecting; })) return;
      io.disconnect();
      fn();
    }, { rootMargin: margin });
    io.observe(el);
  }

  /* ------------------------------------------------------------------ card */
  function Card(root) {
    this.root = root;
    this.path = root.getAttribute('data-path');
    this.openUrl = root.getAttribute('data-open-url');
    this.title = root.getAttribute('data-title') || 'Perfetto trace';
    this.previewSrc = root.getAttribute('data-preview');
    this.openLink = root.querySelector('.pt-open');
    this.hereBtn = root.querySelector('.pt-here');
    this.progressBox = root.querySelector('.pt-progress');
    this.progress = this.progressBox.querySelector('progress');
    this.percent = this.progressBox.querySelector('span');
    this.preview = root.querySelector('.pt-preview');
    this.frame = root.querySelector('.pt-frame');
    this.error = root.querySelector('.pt-error');
    this.autoload = root.querySelector('.pt-autoload input');
    this.state = 'idle';
    this.range = null;
    this.previewPromise = null;
    this.previewPending = false;
    this.previewFailed = false;
    var options = document.createElement('div');
    options.className = 'pt-card-options';
    this.previewToggle = document.createElement('button');
    this.previewToggle.type = 'button';
    this.previewToggle.className = 'pt-preview-toggle';
    this.previewToggle.setAttribute('aria-label', 'Show all trace previews');
    this.previewToggle.hidden = !this.preview;
    this.previewToggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/>' +
      '<circle cx="12" cy="12" r="3"/>' +
      '<path class="pt-preview-slash" d="m3 3 18 18"/></svg>';
    var more = root.querySelector('.pt-card-more');
    more.parentElement.insertBefore(this.previewToggle, more);
    var autoloadLabel = this.autoload.closest('label');
    autoloadLabel.parentElement.appendChild(options);
    options.appendChild(autoloadLabel);
    this.bind();
  }

  Card.prototype.bind = function () {
    var self = this;
    this.openLink.addEventListener('click', function (evt) {
      evt.preventDefault();
      self.openTab();
    });
    this.hereBtn.addEventListener('click', function () { self.loadHere(); });
    this.previewToggle.addEventListener('click', function () {
      var top = self.root.getBoundingClientRect().top;
      showPreviews = !showPreviews;
      writePreviewPreference(showPreviews);
      if (activeTouch) activeTouch.clear();
      if (activeHover) activeHover();
      window.dispatchEvent(new CustomEvent(PREVIEW_EVENT));
      // Keep this button in place when previews above it collapse or expand.
      window.scrollBy(0, self.root.getBoundingClientRect().top - top);
    });
    window.addEventListener(PREVIEW_EVENT, function () { self.syncPreviewVisibility(); });
    this.autoload.checked = readAutoload();
    this.autoload.addEventListener('change', function () {
      writeAutoload(self.autoload.checked);
      window.dispatchEvent(new CustomEvent(AUTOLOAD_EVENT, { detail: self.autoload.checked }));
      if (self.autoload.checked) self.loadHere();
    });
    window.addEventListener(AUTOLOAD_EVENT, function (evt) {
      self.autoload.checked = !!evt.detail;
      if (evt.detail) whenNear(self.root, '400px 0px', function () { if (readAutoload()) self.loadHere(); });
    });
    if (this.autoload.checked) {
      whenNear(this.root, '400px 0px', function () { if (readAutoload()) self.loadHere(); });
    }
    this.syncPreviewVisibility();
  };

  Card.prototype.syncPreviewVisibility = function () {
    this.previewToggle.setAttribute('aria-pressed', String(showPreviews));
    this.previewToggle.title = showPreviews ? 'Hide all trace previews' : 'Show all trace previews';
    if (!this.preview) return;
    var visible = showPreviews && this.state === 'idle' && !this.previewFailed;
    this.preview.hidden = !visible;
    this.root.classList.toggle('has-preview', visible);
    if (!visible || !this.previewSrc || this.previewPromise || this.previewPending) return;
    var self = this;
    this.previewPending = true;
    whenNear(this.root, '600px 0px', function () {
      self.previewPending = false;
      if (showPreviews && self.state === 'idle') self.loadPreview();
    });
  };

  Card.prototype.urlFor = function (range) {
    var url = this.openUrl;
    if (range) url += '&visStart=' + range.start + '&visEnd=' + range.end;
    return url;
  };

  // New tab. Public host: let Perfetto fetch the trace by URL, zoomed to the range.
  // Localhost: open Perfetto and push the bytes with postMessage.
  Card.prototype.openTab = function (range) {
    range = range || this.range;
    if (!isLocalHost()) {
      window.open(this.urlFor(range), '_blank', 'noopener');
      return;
    }
    var self = this;
    this.error.hidden = true;
    var win = window.open(PERFETTO + '/#!/' + (range ? '?visStart=' + range.start + '&visEnd=' + range.end : ''));
    // Blocked pop-up: say so instead of navigating away (Perfetto cannot fetch from localhost anyway).
    if (!win) {
      this.error.textContent = 'The pop-up was blocked. Allow pop-ups for this site, or use "Load here".';
      this.error.hidden = false;
      return;
    }
    fetch(this.path).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (buffer) {
      var tries = 0;
      var pinger = setInterval(function () {
        if (++tries > 160) { clearInterval(pinger); window.removeEventListener('message', onPong); return; }
        win.postMessage('PING', PERFETTO);
      }, 250);
      function onPong(e) {
        if (e.origin !== PERFETTO || e.source !== win || e.data !== 'PONG') return;
        clearInterval(pinger);
        window.removeEventListener('message', onPong);
        win.postMessage({ perfetto: { buffer: buffer, title: self.title, fileName: self.path.split('/').pop() } }, PERFETTO);
      }
      window.addEventListener('message', onPong);
    }).catch(function (err) {
      console.error(err);
      win.location.href = self.urlFor(range);
    });
  };

  Card.prototype.fetchTrace = function () {
    var self = this;
    return fetch(this.path).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var total = Number(response.headers.get('Content-Length')) || 0;
      if (!total) { self.progress.removeAttribute('value'); self.percent.textContent = 'Loading…'; }
      if (!response.body) return response.arrayBuffer();
      var reader = response.body.getReader();
      var chunks = [];
      var loaded = 0;
      function read() {
        return reader.read().then(function (res) {
          if (res.done) return new Blob(chunks).arrayBuffer();
          chunks.push(res.value);
          loaded += res.value.byteLength;
          if (total) {
            var v = Math.min(100, Math.round(loaded * 100 / total));
            self.progress.value = v;
            self.percent.textContent = v + '%';
          }
          return read();
        });
      }
      return read();
    });
  };

  Card.prototype.handOver = function (buffer) {
    var frame = this.frame;
    var self = this;
    return new Promise(function (resolve, reject) {
      var pinger = null;
      var done = false;
      function finish(err) {
        if (done) return;
        done = true;
        clearInterval(pinger);
        clearTimeout(deadline);
        window.removeEventListener('message', onMessage);
        frame.removeEventListener('load', onLoad);
        if (err) reject(err); else resolve();
      }
      function onMessage(evt) {
        if (evt.origin !== PERFETTO || evt.source !== frame.contentWindow || evt.data !== 'PONG') return;
        frame.contentWindow.postMessage({ perfetto: { buffer: buffer, title: self.title, fileName: self.path.split('/').pop() } }, PERFETTO);
        finish();
      }
      var deadline = setTimeout(function () { finish(new Error('Perfetto handshake timed out')); }, HANDSHAKE_TIMEOUT_MS);
      // A load after finish() (e.g. the fallback URL set on timeout) must not start a new pinger.
      function onLoad() {
        frame.removeEventListener('load', onLoad);
        if (done) return;
        pinger = setInterval(function () { frame.contentWindow.postMessage('PING', PERFETTO); }, 250);
      }
      window.addEventListener('message', onMessage);
      frame.addEventListener('load', onLoad);
      frame.src = PERFETTO + '/#!/?mode=embedded' + (self.range ? '&visStart=' + self.range.start + '&visEnd=' + self.range.end : '');
      frame.hidden = false;
    });
  };

  Card.prototype.loadHere = function () {
    if (this.state !== 'idle') return;
    var self = this;
    this.state = 'loading';
    this.hereBtn.hidden = true;
    this.error.hidden = true;
    this.progressBox.hidden = false;
    if (this.preview) this.preview.hidden = true;
    this.root.classList.remove('has-preview');
    this.fetchTrace().then(function (buffer) {
      self.progress.value = 100;
      self.percent.textContent = '100%';
      return self.handOver(buffer).catch(function (err) {
        console.warn(err);
        self.frame.src = self.urlFor(self.range);
      });
    }).then(function () {
      self.state = 'loaded';
      self.progressBox.hidden = true;
    }).catch(function (err) {
      self.state = 'idle';
      self.frame.hidden = true;
      self.progressBox.hidden = true;
      self.hereBtn.hidden = false;
      self.syncPreviewVisibility();
      self.error.textContent = 'Could not load the trace here. Try "Open in Perfetto".';
      self.error.hidden = false;
      console.error(err);
    });
  };

  Card.prototype.loadPreview = function () {
    if (this.previewPromise) return this.previewPromise;
    var self = this;
    this.previewPromise = fetch(this.previewSrc).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(precisePreview).then(function (data) {
      // Normalize display names without changing the stored trace or preview.
      (data.lanes || []).forEach(function (lane) { lane.label = lane.label.replace(/\bmd0\b/g, 'raid0'); });
      (data.charts || []).forEach(function (chart) {
        chart.title = chart.title.replace(/\bmd0\b/g, 'raid0');
        (chart.lines || []).forEach(function (line) { line.name = line.name.replace(/\bmd0\b/g, 'raid0'); });
      });
      self.range = { start: data.window.start_ns, end: data.window.end_ns };
      self.previewData = data;
      renderPreview(self, data);
      // Narrow previews are drawn at 1:1 CSS pixels, so redraw when the width changes (rotation, resize,
      // or a collapsed <details> around the card being opened at a new width).
      var timer = null;
      function recheck() {
        clearTimeout(timer);
        timer = setTimeout(function () {
          if (self.preview.hidden) return;
          var w = previewWidth(self.preview);
          if (w && w !== self.previewW) renderPreview(self, self.previewData);
        }, 150);
      }
      if ('ResizeObserver' in window) new ResizeObserver(recheck).observe(self.preview);
      else window.addEventListener('resize', recheck);
    }).catch(function (err) {
      console.warn('preview', err);
      self.previewFailed = true;
      self.syncPreviewVisibility();
    });
    return this.previewPromise;
  };

  /* ------------------------------------------------------------------ preview */
  var SEG = {
    lock: { color: '#78909c', label: 'lock' },
    unlock: { color: '#8d6e63', label: 'unlock' },
    checkpoint: { color: '#5c6bc0', label: 'checkpoint' },
    restore: { color: '#26a69a', label: 'restore' },
    'cuda-save': { color: '#7e57c2', label: 'CUDA save' },
    'cuda-restore': { color: '#00897b', label: 'CUDA restore' },
    'page-save': { color: '#ab47bc', label: 'pages to file' },
    'page-load': { color: '#43a047', label: 'pages from file' },
    dtoh: { color: '#5c6bc0', label: 'GPU → host copy' },
    htod: { color: '#26a69a', label: 'host → GPU copy' }
  };
  // Counter colours: GPU -> host traffic matches the checkpoint slice, host -> GPU matches restore.
  var LINE = {
    tx: '#5c6bc0', rx: '#26a69a', cpu: '#ef6c00', remote: '#d81b60', local: '#9e9e9e', other: '#f9a825',
    faults: '#6d4c41', write: '#5c6bc0', read: '#26a69a'
  };
  var FONT = 'Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif';

  function fmtS(s) { return (Math.ceil(Number(s) * 10 - 1e-9) / 10).toFixed(1) + ' s'; }
  function fmtTick(t, step) {
    if (step < 0.001) return (t * 1e6).toFixed(0) + 'us';
    if (step < 1) return (t * 1000).toFixed(0) + 'ms';
    return t.toFixed(0) + 's';
  }
  // Up to 3 significant digits, no trailing zeros (2.5, 10, 37.3, 709).
  function sig(v) { return String(+(v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2))); }
  function fmtV(v, unit) {
    if (unit === '/s') {
      if (v >= 1e6) return sig(v / 1e6) + ' M/s';
      if (v >= 1e3) return sig(v / 1e3) + ' k/s';
      return v.toFixed(0) + '/s';
    }
    return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + ' ' + unit;
  }
  function niceMax(v) {
    if (!(v > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var m = v / p;
    var n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
    return n * p;
  }
  // Ruler step from the 1-2-5 series closest to span / target (Perfetto-like 5-9 ticks).
  function niceStep(span, target) {
    var raw = span / target;
    var p = Math.pow(10, Math.floor(Math.log10(raw)));
    var m = raw / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }
  function el(name, attrs, text) {
    var n = document.createElementNS(SVGNS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  function fit(text, px, charW) {
    var n = Math.floor(px / charW);
    if (text.length <= n) return text;
    return n >= 4 ? text.slice(0, n - 1) + '…' : '';
  }
  // Splits a track name over two lines (narrow shell); the second line is ellipsized. Prefers the
  // ' · ' separator ('rank 0' / 'GPU 0'), then a space, then a camelCase boundary in a single word
  // ('cuMemcpyDtoH' / 'Async'), so a number never ends up alone and similar names stay distinct.
  function wrap2(text, px, charW) {
    var n = Math.floor(px / charW);
    if (text.length <= n) return [text];
    var dot = text.lastIndexOf(' · ', n);
    if (dot > 0) {
      var tail = fit(text.slice(dot + 3), px, charW);
      if (tail) return [text.slice(0, dot), tail];
    }
    var cut = text.lastIndexOf(' ', n);
    if (cut > 0) {
      var rest = fit(text.slice(cut + 1), px, charW);
      if (rest) return [text.slice(0, cut), rest];
    }
    // Last upper-case letter that starts a new word (after a lower-case one, or before one).
    for (var i = Math.min(n, text.length - 1); i > 1; i--) {
      var c = text.charAt(i), p = text.charAt(i - 1), q = text.charAt(i + 1);
      var up = /[A-Z]/.test(c);
      if (up && (/[a-z0-9]/.test(p) || (/[A-Z]/.test(p) && /[a-z]/.test(q)))) {
        var more = fit(text.slice(i), px, charW);
        if (more) return [text.slice(0, i), more];
        break;
      }
    }
    return [fit(text, px, charW)];
  }
  // Drawing width of a preview: 760 (scaled to fit) on wide screens, the CSS width (1:1) below that,
  // so SVG text never renders smaller than its nominal size.
  function previewWidth(box) {
    var cs = getComputedStyle(box);
    var avail = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2;
    if (!(avail > 0)) return 0;
    return avail < 760 ? Math.max(280, Math.floor(avail)) : 760;
  }
  // Index of the last sample at or before t (0 when t is before the first). Counter values are bin
  // averages stamped at the bin start and drawn as a step, so this is the value under the cursor.
  function floorIndex(points, t) {
    if (!points || !points.length) return -1;
    var lo = 0, hi = points.length - 1;
    if (points[hi][0] <= t) return hi;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (points[mid][0] <= t) lo = mid; else hi = mid;
    }
    return lo;
  }

  // Touch: the preview whose cursor was placed by a tap. A tap elsewhere clears it; scrolling hides its
  // tooltip, which is position: fixed and would otherwise drift away from the plot.
  // activeHover is the leave() of the preview a mouse is over; its tooltip and cursor go away on scroll.
  var activeTouch = null, activeHover = null;
  document.addEventListener('pointerdown', function (e) {
    if (activeTouch && !activeTouch.owns(e.target)) activeTouch.clear();
  }, true);
  window.addEventListener('scroll', function () {
    if (activeTouch) activeTouch.hideTip();
    if (activeHover) activeHover();
  }, { passive: true });

  // Renders a static, Perfetto-looking view of one window of the trace: time ruler on top, a track-name
  // shell on the left, slice tracks, then one counter track per series. Metrics go below the plot.
  function renderPreview(card, d) {
    var box = card.preview;
    if (activeTouch && activeTouch.card === card) activeTouch = null;
    // Measure before clearing: narrow screens draw at 1:1 with a narrower shell and two-line names.
    var W = previewWidth(box) || 760;
    var compact = W < 600;
    card.previewW = W;
    box.innerHTML = '';

    // Geometry
    var L = compact ? (W < 400 ? 100 : 120) : 180, R = 8, BW = 26, RULER = 26, SLICE_H = 30, CTR_H = 42;
    var lanes = d.lanes || [];
    var breaks = (d.breaks || []).slice().sort(function (a, b) { return a.start - b.start; });
    var total = d.window.seconds;
    var hidden = breaks.reduce(function (s, b) { return s + (b.end - b.start); }, 0);
    var plotW = W - L - R;
    var scale = (plotW - BW * breaks.length) / Math.max(1e-6, total - hidden);
    function X(t) {
      var pos = L, prev = 0;
      for (var i = 0; i < breaks.length; i++) {
        var b = breaks[i];
        if (t <= b.start) return pos + (t - prev) * scale;
        pos += (b.start - prev) * scale + BW;
        if (t < b.end) return pos - BW / 2;
        prev = b.end;
      }
      return pos + (t - prev) * scale;
    }
    function T(px) {
      var pos = L, prev = 0;
      for (var i = 0; i < breaks.length; i++) {
        var b = breaks[i];
        var segEnd = pos + (b.start - prev) * scale;
        if (px <= segEnd) return prev + (px - pos) / scale;
        if (px <= segEnd + BW) return null;
        pos = segEnd + BW;
        prev = b.end;
      }
      return prev + (px - pos) / scale;
    }

    // Counter tracks: one per series, as in Perfetto.
    var counters = [];
    (d.charts || []).forEach(function (c) {
      if (c.gpus && c.gpus.length) {
        c.gpus.forEach(function (g) {
          counters.push({ name: 'GPU ' + g.gpu + ' PCIe TX (to host)', short: 'GPU ' + g.gpu + ' TX', color: LINE.tx, points: g.tx, unit: c.unit });
          counters.push({ name: 'GPU ' + g.gpu + ' PCIe RX (from host)', short: 'GPU ' + g.gpu + ' RX', color: LINE.rx, points: g.rx, unit: c.unit });
        });
      } else if (c.lines) {
        var live = c.lines.filter(function (l) { return l.points && l.points.length; });
        // A chart with several series (or a generic title such as "NUMA") names each track after its series.
        var byLine = live.length > 1 || c.id === 'numa';
        live.forEach(function (l) {
          counters.push({ name: byLine ? l.name : c.title.replace(/\s*\(.*\)$/, ''), full: byLine ? c.title + ' · ' + l.name : c.title, short: l.name,
            color: LINE[l.color] || '#546e7a', points: l.points, unit: c.unit });
        });
      }
    });

    var svg = el('svg', { viewBox: '0 0 ' + W + ' 10', role: 'img', 'aria-label': 'Preview of ' + (d.title || 'the trace'), 'font-family': FONT });
    // gGaps sits above the slices so a gap label is never painted over by a later slice.
    var gGrid = el('g'), gTracks = el('g'), gGaps = el('g'), gTop = el('g');
    // Always white, like Perfetto's light theme, even when the site is in dark mode.
    var bg = el('rect', { x: 0, y: 0, width: W, height: 10, fill: '#fff' });
    svg.appendChild(bg);
    svg.appendChild(gGrid);
    svg.appendChild(gTracks);
    svg.appendChild(gGaps);
    svg.appendChild(gTop);
    var rows = [];
    var y = RULER;

    function shell(ty, h, label, full) {
      gTracks.appendChild(el('rect', { x: 0, y: ty, width: L, height: h, fill: '#fff' }));
      var lines = compact ? wrap2(label, L - 14, 6.3) : [fit(label, L - 18, 6.1)];
      var t = el('text', { x: compact ? 8 : 10, y: ty + h / 2 + (lines.length > 1 ? -2 : 4), 'font-size': compact ? 11 : 11.5, fill: '#3c4043' },
        lines.length > 1 ? null : lines[0]);
      if (lines.length > 1) {
        t.appendChild(el('tspan', {}, lines[0]));
        t.appendChild(el('tspan', { x: 8, dy: 12 }, lines[1]));
      }
      if (full && full !== label) t.appendChild(el('title', {}, full));
      gTracks.appendChild(t);
      gTracks.appendChild(el('line', { x1: 0, x2: W, y1: ty + h + 0.5, y2: ty + h + 0.5, stroke: '#e0e0e0' }));
    }

    // Slice tracks
    lanes.forEach(function (lane) {
      var ly = y;
      shell(ly, SLICE_H, lane.label, lane.label);
      var segs = lane.segments.slice().sort(function (a, b) { return a.start - b.start; });
      var rects = [];
      segs.forEach(function (s, i) {
        var st = SEG[s.name] || { color: '#90a4ae', label: s.name };
        // Short slices (lock / unlock take milliseconds) get 2 px so they stay visible.
        var x0 = X(s.start), x1 = X(s.end), w = Math.max(2, x1 - x0);
        var r = el('rect', { x: x0, y: ly + 4, width: w, height: SLICE_H - 8, fill: st.color });
        gTracks.appendChild(r);
        rects.push(r);
        var withDur = st.label + ' (' + fmtS(s.dur) + ')';
        var label = withDur.length * 5.9 + 8 <= w ? withDur : fit(st.label, w - 6, 5.9);
        if (label) gTracks.appendChild(el('text', { x: x0 + w / 2, y: ly + SLICE_H / 2 + 4, 'text-anchor': 'middle', 'font-size': 11, fill: '#fff' }, label));
        var next = segs[i + 1];
        if (next) {
          var gap = next.start - s.end;
          var gx0 = X(s.end), gx1 = X(next.start);
          var minGap = Math.max(0.25, 0.012 * (total - hidden));
          var acrossCut = breaks.some(function (b) { return s.end <= b.start && next.start >= b.end; });
          var gl = '+' + fmtS(gap);
          var glW = gl.length * 5.4 + 4;
          // Label the idle gap only when the label fits between the two slices.
          if (gap >= minGap && gx1 - gx0 >= glW + 6 && !acrossCut) {
            var my = ly + SLICE_H / 2;
            gGaps.appendChild(el('path', { d: 'M' + (gx0 + 2) + ' ' + (my - 3) + ' v6 M' + (gx0 + 2) + ' ' + my + ' H' + (gx1 - 2) + ' M' + (gx1 - 2) + ' ' + (my - 3) + ' v6', stroke: '#9aa0a6', fill: 'none' }));
            gGaps.appendChild(el('rect', { x: (gx0 + gx1) / 2 - glW / 2, y: my - 7, width: glW, height: 13, fill: '#fff' }));
            gGaps.appendChild(el('text', { x: (gx0 + gx1) / 2, y: my + 3.5, 'text-anchor': 'middle', 'font-size': 10, fill: '#5f6368' }, gl));
          }
        }
      });
      rows.push({ kind: 'lane', lane: lane, segs: segs, rects: rects });
      y += SLICE_H;
    });

    // Counter tracks
    counters.forEach(function (c) {
      var cy = y;
      shell(cy, CTR_H, c.name, c.full || c.name);
      var vmax = niceMax(c.points.reduce(function (a, p) { return Math.max(a, p[1]); }, 0));
      var top = cy + 15, base = cy + CTR_H - 3;
      function Y(v) { return base - (v / vmax) * (base - top); }
      var dLine = '', dArea = '', prevT = null, startX = null, lastX = null;
      function closeArea() { if (startX !== null) dArea += 'L' + lastX.toFixed(1) + ' ' + base + 'L' + startX.toFixed(1) + ' ' + base + 'Z'; }
      function crossed(t0, t1) { return breaks.filter(function (b) { return t0 < b.start && t1 > b.start; })[0] || null; }
      c.points.forEach(function (p, i) {
        var jumpB = prevT !== null ? crossed(prevT, p[0]) : null, jump = !!jumpB;
        // The first and last samples stretch to the window edges so the track has no holes; around a
        // cut the fill runs up to its dashed edges (2 px inside the cut column).
        var px = i === 0 ? L : jump ? X(jumpB.end) - 2 : Math.max(L, X(p[0])), py = Y(p[1]);
        var nextB = i + 1 < c.points.length ? crossed(p[0], c.points[i + 1][0]) : null;
        var nx = nextB ? X(nextB.start) + 2 : i + 1 < c.points.length ? X(c.points[i + 1][0]) : W - R;
        if (dLine === '' || jump) {
          closeArea();
          dLine += 'M' + px.toFixed(1) + ' ' + py.toFixed(1);
          dArea += 'M' + px.toFixed(1) + ' ' + base + 'L' + px.toFixed(1) + ' ' + py.toFixed(1);
          startX = px;
        } else {
          dLine += 'V' + py.toFixed(1);
          dArea += 'V' + py.toFixed(1);
        }
        var endX = nx;
        dLine += 'H' + endX.toFixed(1);
        dArea += 'H' + endX.toFixed(1);
        lastX = endX;
        prevT = p[0];
      });
      closeArea();
      if (dArea) gTracks.appendChild(el('path', { d: dArea, fill: c.color, 'fill-opacity': 0.45, stroke: 'none' }));
      if (dLine) gTracks.appendChild(el('path', { d: dLine, fill: 'none', stroke: c.color, 'stroke-width': 1.2 }));
      gTracks.appendChild(el('text', { x: L + 4, y: cy + 11.5, 'font-size': 10, fill: '#5f6368' }, fmtV(vmax, c.unit)));
      rows.push({ kind: 'counter', c: c });
      y += CTR_H;
    });
    var H = y + 1;

    // Shell divider
    gTop.appendChild(el('line', { x1: L - 0.5, x2: L - 0.5, y1: 0, y2: H, stroke: '#dadce0' }));

    // Time ruler (top) and grid
    gTop.appendChild(el('rect', { x: 0, y: 0, width: W, height: RULER, fill: '#fff' }));
    gTop.appendChild(el('line', { x1: 0, x2: W, y1: RULER - 0.5, y2: RULER - 0.5, stroke: '#dadce0' }));
    gTop.appendChild(el('text', { x: compact ? 8 : 10, y: 17, 'font-size': 11, fill: '#5f6368' },
      fit(fmtS(total - hidden) + (breaks.length ? ' shown' : ' window'), L - 12, 5.8)));
    gTop.appendChild(el('line', { x1: L - 0.5, x2: L - 0.5, y1: 0, y2: RULER, stroke: '#dadce0' }));
    var visible = total - hidden;
    var step = niceStep(visible, compact ? Math.max(3, Math.round(plotW / 80)) : 7);
    // Each segment after a cut starts with its own labelled tick, so the time scale stays readable
    // on both sides; regular ticks skip positions whose label would collide with a previous one.
    var ticks = [];
    breaks.forEach(function (b) { ticks.push({ t: b.end, x: X(b.end) + 0.5, txt: step >= 1 ? b.end.toFixed(0) + 's' : fmtS(b.end), grid: false }); });
    for (var t = 0; t <= total + 1e-9; t += step) {
      if (breaks.some(function (b) { return t > b.start - step * 0.4 && t < b.end; })) continue;
      ticks.push({ t: t, x: X(t), txt: fmtTick(t, step), grid: true });
    }
    ticks.sort(function (a, b) { return a.x - b.x; });
    var used = [];
    ticks.forEach(function (k) {
      var lw = k.txt.length * 6 + 3;
      if (k.x + lw > W - R + 2) return;
      if (breaks.some(function (b) { var bx = X(b.start); return k.x < bx + BW && k.x + lw > bx; })) return;
      if (used.some(function (u) { return k.x < u[1] + 6 && k.x + lw > u[0] - 6; })) return;
      used.push([k.x, k.x + lw]);
      if (k.grid) gGrid.appendChild(el('line', { x1: k.x, x2: k.x, y1: RULER, y2: H, stroke: '#eceff1' }));
      gTop.appendChild(el('line', { x1: k.x, x2: k.x, y1: 8, y2: RULER, stroke: '#9aa0a6' }));
      gTop.appendChild(el('text', { x: k.x + 3, y: 17, 'font-size': 10.5, fill: '#5f6368' }, k.txt));
    });
    breaks.forEach(function (b) {
      var bx = X(b.start);
      gTop.appendChild(el('rect', { x: bx + 2, y: 0, width: BW - 4, height: H, fill: '#fff' }));
      gTop.appendChild(el('path', { d: 'M' + (bx + 2) + ' 0 V' + H + ' M' + (bx + BW - 2) + ' 0 V' + H, stroke: '#bdc1c6', 'stroke-dasharray': '3 3' }));
      var lbl = el('text', { x: bx + BW / 2, y: RULER + (H - RULER) / 2, 'text-anchor': 'middle', 'font-size': 10, fill: '#5f6368',
        transform: 'rotate(-90 ' + (bx + BW / 2) + ' ' + (RULER + (H - RULER) / 2) + ')' }, fmtS(b.end - b.start) + ' not shown');
      gTop.appendChild(lbl);
    });
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    bg.setAttribute('height', H);

    // Hover layer
    var cursor = el('line', { x1: 0, x2: 0, y1: RULER, y2: H, stroke: '#1a73e8', 'stroke-width': 1, visibility: 'hidden' });
    var flag = el('g', { visibility: 'hidden' });
    var flagRect = el('rect', { x: 0, y: 4, width: 10, height: 18, rx: 2, fill: '#1a73e8' });
    var flagText = el('text', { x: 0, y: 17, 'font-size': 10.5, fill: '#fff' }, '');
    flag.appendChild(flagRect);
    flag.appendChild(flagText);
    svg.appendChild(cursor);
    svg.appendChild(flag);

    var plot = document.createElement('div');
    plot.className = 'pt-pv-plot';
    plot.tabIndex = 0;
    plot.setAttribute('role', 'button');
    // No native title: the browser tooltip would cover the custom one.
    plot.setAttribute('aria-label', 'Open this window of the trace in Perfetto in a new tab');
    plot.appendChild(svg);
    var tip = document.createElement('div');
    tip.className = 'pt-pv-tip';
    tip.setAttribute('aria-hidden', 'true');
    tip.hidden = true;
    plot.appendChild(tip);
    box.appendChild(plot);

    function describe(t) {
      var html = '<div class="pt-tt-t">' + fmtS(Math.max(0, t)) + (d.kind === 'cuda' ? ' into the preview window' : ' into the window') + '</div>';
      rows.forEach(function (r) {
        if (r.kind === 'lane') {
          var cur = null, before = null, after = null;
          r.segs.forEach(function (s) {
            if (t >= s.start && t <= s.end) cur = s;
            if (s.end < t) before = s;
            if (s.start > t && !after) after = s;
          });
          var text;
          if (cur) {
            var st = SEG[cur.name] || { label: cur.name, color: '#90a4ae' };
            text = '<span class="pt-tt-sw" style="background:' + st.color + '"></span>' + esc(st.label) + ' · ' + fmtS(cur.dur);
          } else if (before && after) {
            var bl = (SEG[before.name] || {}).label || before.name, al = (SEG[after.name] || {}).label || after.name;
            text = 'idle ' + fmtS(after.start - before.end) + (bl === al ? '' : ' (' + esc(bl) + ' → ' + esc(al) + ')');
          } else {
            text = '—';
          }
          html += '<div class="pt-tt-row"><span>' + esc(r.lane.label) + '</span><span>' + text + '</span></div>';
        } else {
          // Same lookup as the drawn step: the sample at or before t, or the first one after a cut.
          var pts = r.c.points, k = floorIndex(pts, t);
          if (k < 0) return;
          if (k + 1 < pts.length && breaks.some(function (b) { return pts[k][0] < b.start && t >= b.start; })) k++;
          var p = pts[k];
          html += '<div class="pt-tt-row"><span><span class="pt-tt-sw" style="background:' + r.c.color + '"></span>' + esc(r.c.name) + '</span><span>' + fmtV(p[1], r.c.unit) + '</span></div>';
        }
      });
      return html;
    }

    function highlight(t) {
      rows.forEach(function (r) {
        if (r.kind !== 'lane') return;
        r.segs.forEach(function (s, i) {
          var on = t !== null && t >= s.start && t <= s.end;
          if (on) { r.rects[i].setAttribute('stroke', '#202124'); r.rects[i].setAttribute('stroke-width', '1.5'); }
          else r.rects[i].removeAttribute('stroke');
        });
      });
    }

    // Places the cursor and tooltip at the pointer. Returns false when the pointer is outside the tracks.
    // Touch puts the tooltip above the finger so the finger does not hide it.
    function move(evt, touch) {
      var rect = svg.getBoundingClientRect();
      var px = (evt.clientX - rect.left) * (W / rect.width);
      if (px < L || px > W - R) { leave(); return false; }
      var t = T(px);
      cursor.setAttribute('x1', px);
      cursor.setAttribute('x2', px);
      cursor.setAttribute('visibility', 'visible');
      highlight(t);
      if (t === null) {
        var b = breaks.filter(function (br) { var bx = X(br.start); return px >= bx && px <= bx + BW; })[0];
        tip.innerHTML = '<div class="pt-tt-t">' + esc(b ? b.label : 'not shown') + '</div>';
        flag.setAttribute('visibility', 'hidden');
      } else {
        tip.innerHTML = describe(t);
        var ft = fmtS(Math.max(0, t));
        var fw = ft.length * 6.2 + 8;
        var fx = Math.min(px, W - R - fw);
        flagRect.setAttribute('x', fx);
        flagRect.setAttribute('width', fw);
        flagText.setAttribute('x', fx + 4);
        flagText.textContent = ft;
        flag.setAttribute('visibility', 'visible');
      }
      // The tooltip is position: fixed, so it is placed in viewport coordinates and kept on screen:
      // right of the cursor (left if no room), below it (above if no room).
      tip.hidden = false;
      // Measure at the origin: a fixed box near the right edge would otherwise shrink to the space left.
      tip.style.left = '0px';
      tip.style.top = '0px';
      var vw = document.documentElement.clientWidth, vh = window.innerHeight, pad = 8;
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      var left = evt.clientX + 16;
      if (left + tw > vw - pad) left = evt.clientX - tw - 16;
      left = Math.max(pad, Math.min(left, vw - tw - pad));
      var top = evt.clientY + 16;
      if (touch) {
        top = evt.clientY - th - 28;
        if (top < pad) top = evt.clientY + 28;
      } else if (top + th > vh - pad) top = evt.clientY - th - 16;
      top = Math.max(pad, Math.min(top, vh - th - pad));
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
      return true;
    }
    function leave() {
      if (activeHover === leave) activeHover = null;
      tip.hidden = true; cursor.setAttribute('visibility', 'hidden'); flag.setAttribute('visibility', 'hidden'); highlight(null);
    }

    // Touch has no hover: a tap places the cursor and shows the values, a drag moves the cursor, and a
    // second tap on the same spot (or the button under the plot) opens Perfetto. touch-action: pan-y
    // in the CSS keeps vertical page scrolling; a vertical swipe arrives here as pointercancel.
    var bar = document.createElement('div');
    bar.className = 'pt-pv-touchbar';
    bar.hidden = true;
    bar.innerHTML = '<button type="button" class="pt-pv-go">Open this window in Perfetto <span aria-hidden="true">&#8599;</span></button>' +
      '<button type="button" class="pt-pv-x" aria-label="Hide the cursor">&times;</button>';
    var lastType = 'mouse', down = null, shownAt = null;
    var touchCtl = {
      card: card,
      owns: function (n) { return plot.contains(n) || bar.contains(n); },
      clear: clearTouch,
      // Scrolling moves the plot under the fixed tooltip and makes shownAt (viewport coordinates) stale,
      // so the next tap shows values again instead of opening Perfetto.
      hideTip: function () { tip.hidden = true; shownAt = null; }
    };
    function clearTouch() {
      shownAt = null;
      bar.hidden = true;
      leave();
      if (activeTouch === touchCtl) activeTouch = null;
    }
    function showTouch(evt) {
      shownAt = { x: evt.clientX, y: evt.clientY };
      bar.hidden = false;
      if (activeTouch && activeTouch !== touchCtl) activeTouch.clear();
      activeTouch = touchCtl;
    }
    plot.addEventListener('pointerdown', function (e) {
      lastType = e.pointerType || 'mouse';
      if (lastType === 'mouse') return;
      down = { id: e.pointerId, x: e.clientX, drag: false };
    });
    plot.addEventListener('pointermove', function (e) {
      if (!e.pointerType || e.pointerType === 'mouse') {
        if (move(e, false)) {
          if (activeHover && activeHover !== leave) activeHover();
          activeHover = leave;
        }
        return;
      }
      if (!down || e.pointerId !== down.id) return;
      if (!down.drag && Math.abs(e.clientX - down.x) < 6) return;
      down.drag = true;
      if (move(e, true)) showTouch(e);
    });
    plot.addEventListener('pointerup', function (e) {
      if (!e.pointerType || e.pointerType === 'mouse' || !down || e.pointerId !== down.id) return;
      var dragged = down.drag;
      down = null;
      if (!dragged && shownAt && !tip.hidden && Math.abs(e.clientX - shownAt.x) <= 24 && Math.abs(e.clientY - shownAt.y) <= 40) {
        card.openTab(card.range);
        return;
      }
      if (move(e, true)) showTouch(e); else clearTouch();
    });
    plot.addEventListener('pointercancel', function (e) {
      if (down && e.pointerId === down.id) { down = null; tip.hidden = true; shownAt = null; }
    });
    plot.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') leave(); });
    // The click that follows a tap is handled by pointerup above.
    plot.addEventListener('click', function () {
      if (lastType !== 'mouse') { lastType = 'mouse'; return; }
      card.openTab(card.range);
    });
    plot.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.openTab(card.range); } });
    bar.querySelector('.pt-pv-go').addEventListener('click', function () { card.openTab(card.range); });
    bar.querySelector('.pt-pv-x').addEventListener('click', clearTouch);
    box.appendChild(bar);

    // Metrics (below the plot)
    var chips = document.createElement('div');
    chips.className = 'pt-pv-metrics';
    (d.metrics || []).forEach(function (m) {
      var c = document.createElement('span');
      c.className = 'pt-chip';
      var value = m.unit === 's' ? fmtS(m.value) : esc(m.value) + (m.unit === '%' ? '%' : m.unit ? ' ' + esc(m.unit) : '');
      var label = m.label === 'cycle' ? 'Elapsed cycle' : m.label.replace(/\bmd0\b/g, 'raid0');
      if (m.label === 'remote NUMA faults') label = 'Remote NUMA hint faults';
      if (m.label === 'pages on other node') label = 'Pages allocated on other nodes';
      var note = m.note || (m.label === 'cycle' ? 'Selected warm cycle, including gaps' : '');
      if (m.label === 'cycle') c.title = 'Lock start to unlock end for one warm cycle. The overview uses phase totals or medians.';
      if (/^peak /.test(m.label)) c.title = 'Peak of sampled values' + (d.dt ? '; sample interval ' + fmtS(d.dt) : '') + '.';
      c.innerHTML = '<b>' + value + '</b>' + esc(label) +
        (note ? ' <span class="pt-chip-note">(' + esc(note) + ')</span>' : '');
      chips.appendChild(c);
    });
    box.appendChild(chips);
  }

  /* ------------------------------------------------------------------ init */
  function scan() {
    var cards = document.querySelectorAll('.pt-card');
    for (var i = 0; i < cards.length; i++) {
      if (!cards[i].__ptCard) cards[i].__ptCard = new Card(cards[i]);
    }
  }
  window.__perfettoCards = { scan: scan };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan); else scan();
})();
