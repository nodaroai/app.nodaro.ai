/**
 * App-run widget — live status header + gallery-style outputs grid for
 * `run_app` executions.
 *
 * Static template registered at `ui://nodaro/widget/v3/app-run`. The host
 * delivers per-call data via:
 *   - `ui/notifications/tool-result` — initial { executionId, slug, name }
 *
 * Outputs flow in via the widget polling `get_app_run` every 2s — same
 * pattern the workflow + single-job widgets use, since stateless HTTP MCP
 * can't deliver async progress notifications after the tool call returns.
 *
 * Visual model: gallery widget grid (same tile / hover-Use+Download /
 * fullscreen-detail / filmstrip surface), but scoped to one run. The user
 * gets their app outputs in a gallery-shaped grid as they arrive.
 *
 * DOM-construction safety: `document.createElement` + `textContent` +
 * `setAttribute` only.
 */
import { uiProtocolShim } from "./_common.js"

const APP_RUN_CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 12px; font: 13px system-ui, sans-serif; background: transparent; color: inherit; }
  /* Card shell — matches gallery's mobile-only treatment so the run sits
     in its own frame in chat. Desktop drops the chrome (see hover query). */
  .card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    border: 1px solid rgba(127,127,127,0.18);
    background: rgba(127,127,127,0.04);
    border-radius: 14px;
    padding: 12px;
  }
  /* Status header — app name on left, status pill on right. While running,
     a thin progress bar sits beneath, animated until terminal status. */
  .status-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .status-row .name { font-size: 13px; font-weight: 600; opacity: 0.9; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pill {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 3px 10px; border-radius: 999px;
    font-size: 11px; font-weight: 600; letter-spacing: 0.02em;
    flex-shrink: 0;
  }
  .pill .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  .pill.running { background: rgba(91,157,255,0.18); color: #5b9dff; }
  .pill.running .dot { animation: pulse 1.5s infinite; }
  .pill.done { background: rgba(91,210,127,0.18); color: #2fa55a; }
  .pill.failed { background: rgba(255,91,91,0.18); color: #d43f3f; }
  .pill.queued { background: rgba(127,127,127,0.18); color: rgba(127,127,127,0.95); }
  @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }
  /* Indeterminate progress bar — only visible while running. */
  .progress-bar {
    height: 2px; width: 100%; overflow: hidden;
    background: rgba(127,127,127,0.12); border-radius: 1px;
    position: relative;
  }
  .progress-bar::after {
    content: '';
    position: absolute; top: 0; left: -40%;
    width: 40%; height: 100%;
    background: #5b9dff;
    border-radius: 1px;
    animation: progress-slide 1.4s infinite ease-in-out;
  }
  @keyframes progress-slide {
    0%   { left: -40%; }
    100% { left: 100%; }
  }
  /* Grid — same density + tile chrome as the gallery widget. */
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
  .tile { position: relative; aspect-ratio: 1/1; border-radius: 8px; overflow: hidden; background: rgba(0,0,0,0.05); cursor: pointer; }
  .tile img, .tile video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .hover-overlay {
    display: none;
    position: absolute;
    inset: 0;
    align-items: flex-end;
    justify-content: stretch;
    gap: 6px;
    padding: 8px;
    opacity: 0;
    transition: opacity .15s;
    background: linear-gradient(180deg, rgba(0,0,0,0) 50%, rgba(0,0,0,0.45) 100%);
    pointer-events: none;
  }
  .hover-overlay > * { pointer-events: auto; }
  .use {
    flex: 1;
    min-width: 0;
    padding: 6px 12px;
    text-align: center;
    background: #ff0073;
    color: #fff;
    border-radius: 999px;
    font-weight: 600;
    font-size: 12px;
    cursor: pointer;
    line-height: 1.4;
    transition: background .15s;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .use:hover { background: #d6005f; }
  .tile-download {
    flex: 0 0 28px;
    display: flex; align-items: center; justify-content: center;
    height: 28px;
    background: rgba(0,0,0,0.55); color: #fff;
    border-radius: 999px; cursor: pointer; transition: background .15s;
  }
  .tile-download:hover { background: rgba(0,0,0,0.75); }
  .tile-download svg { display: block; width: 14px; height: 14px; }
  @media (hover: hover) and (pointer: fine) {
    .hover-overlay { display: flex; }
    .tile:hover .hover-overlay { opacity: 1; }
    .card {
      border: 0;
      background: transparent;
      border-radius: 0;
      padding: 0;
    }
  }
  /* Audio tile — icon + clamped label, matches gallery treatment. */
  .audio-tile {
    width: 100%; height: 100%;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 6px; padding: 8px; text-align: center;
    background: linear-gradient(135deg, rgba(91,157,255,0.18), rgba(142,107,255,0.18));
  }
  .audio-tile .audio-icon { width: 28px; height: 28px; opacity: 0.75; }
  .audio-tile .audio-label {
    font-size: 11px; line-height: 1.2; opacity: 0.85;
    overflow: hidden; display: -webkit-box;
    -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word;
  }
  /* Empty / placeholder states. */
  .empty {
    text-align: center; padding: 28px 8px;
    opacity: 0.7; font-size: 12px;
  }
  .empty .empty-icon { display: block; margin: 0 auto 8px; width: 32px; height: 32px; opacity: 0.5; }
  /* Detail view — wraps inside the card shell, mirrors gallery exactly so
     the surface feels uniform between gallery + run-grid. */
  .detail { display: flex; flex-direction: column; gap: 12px; }
  .detail .preview { width: 100%; max-height: 60vh; display: flex; align-items: center; justify-content: center; position: relative; }
  .detail .preview img, .detail .preview video, .detail .preview audio { width: 100%; height: auto; max-height: 60vh; object-fit: contain; border-radius: 8px; }
  .filmstrip {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 4px 2px;
    scrollbar-width: thin;
    flex: 0 0 72px;
  }
  .filmstrip::-webkit-scrollbar { height: 6px; }
  .filmstrip::-webkit-scrollbar-thumb { background: rgba(127,127,127,0.3); border-radius: 3px; }
  .filmstrip .strip-item {
    flex: 0 0 auto;
    width: 60px; height: 60px;
    border-radius: 8px;
    overflow: hidden;
    background: rgba(0,0,0,0.05);
    cursor: pointer;
    border: 2px solid transparent;
    transition: border-color .15s, transform .15s;
  }
  .filmstrip .strip-item:hover { transform: scale(1.05); }
  .filmstrip .strip-item.active { border-color: #ff0073; }
  .filmstrip .strip-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .filmstrip .strip-audio {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(135deg, rgba(91,157,255,0.18), rgba(142,107,255,0.18));
    color: rgba(127,127,127,0.85);
    font-size: 14px;
  }
  .detail .meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 12px;
    opacity: 0.85;
    flex-shrink: 0;
    min-height: 22px;
  }
  .detail .meta .meta-left {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    min-width: 0;
    flex: 1;
  }
  .detail .meta .badge { background: rgba(127,127,127,0.15); padding: 2px 8px; border-radius: 4px; flex-shrink: 0; }
  .detail .meta .meta-date { opacity: 0.7; }
  .detail .actions { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-shrink: 0; }
  .actions-left, .actions-right { display: flex; align-items: center; }
  .actions-left { gap: 8px; }
  .actions-right { gap: 2px; }
  button { padding: 6px 12px; border: none; background: transparent; color: inherit; border-radius: 6px; font-size: 13px; cursor: pointer; opacity: 0.7; transition: opacity .15s, background .15s, color .15s; font-family: inherit; line-height: 1; display: inline-flex; align-items: center; gap: 6px; }
  button:hover { background: rgba(127,127,127,0.1); opacity: 1; }
  button.icon-btn { padding: 6px; gap: 0; opacity: 0.6; }
  button.icon-btn:hover { opacity: 1; }
  button.icon-btn svg { display: block; width: 14px; height: 14px; }
  button svg.lead { display: block; width: 12px; height: 12px; }
  /* Fullscreen — mirrors gallery's mode shape exactly. */
  :root { --fs-top-pad: 40px; }
  body.fullscreen { padding: var(--fs-top-pad) 0 0 0; margin: 0; height: 100dvh; overflow: hidden; }
  body.fullscreen .card {
    height: 80dvh;
    max-height: calc(100dvh - var(--fs-top-pad));
    display: flex;
    flex-direction: column;
    border: 0;
    background: transparent;
    padding: 8px 12px;
    border-radius: 0;
    gap: 8px;
    overflow: hidden;
  }
  body.fullscreen .preview {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }
  body.fullscreen .preview img,
  body.fullscreen .preview video {
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 0;
  }
  .nav-arrow {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 36px; height: 36px;
    border-radius: 50%;
    background: rgba(0,0,0,0.4);
    color: #fff;
    border: 0;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    opacity: 0.8;
    transition: opacity .15s, background .15s;
    z-index: 5;
  }
  .nav-arrow:hover:not(:disabled) { opacity: 1; background: rgba(0,0,0,0.6); }
  .nav-arrow:disabled { opacity: 0.2; cursor: default; }
  .nav-arrow.prev { left: 8px; }
  .nav-arrow.next { right: 8px; }
  .nav-arrow svg { display: block; width: 18px; height: 18px; stroke-width: 2.5; }
  @media (hover: hover) and (pointer: fine) {
    :root { --fs-top-pad: 0px; }
    body.fullscreen {
      padding-left: 32px;
      padding-right: 32px;
    }
    body.fullscreen .card {
      max-width: 800px;
      margin: 0 auto;
      padding: 8px 0;
    }
  }
`

export function buildAppRunWidgetTemplate(): string {
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8" />
<style>${APP_RUN_CSS}</style>
${uiProtocolShim()}
</head>
<body>
<div id="root"><div class="empty">Starting…</div></div>
<template id="tpl-audio-tile">
  <div class="audio-tile">
    <svg class="audio-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
    </svg>
    <span class="audio-label"></span>
  </div>
</template>
<template id="tpl-download-icon">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
</template>
<template id="tpl-chev-left">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="15 18 9 12 15 6"/>
  </svg>
</template>
<template id="tpl-chev-right">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="9 18 15 12 9 6"/>
  </svg>
</template>
<template id="tpl-icon-play">
  <svg class="lead" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
    <polygon points="6 4 20 12 6 20 6 4"/>
  </svg>
</template>
<template id="tpl-icon-edit">
  <svg class="lead" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
</template>
<template id="tpl-icon-copy">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
</template>
<template id="tpl-icon-recreate">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
    <path d="M21 3v5h-5"/>
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
    <path d="M3 21v-5h5"/>
  </svg>
</template>
<template id="tpl-empty-spark">
  <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/>
    <path d="M5.6 5.6l2.1 2.1"/><path d="M16.3 16.3l2.1 2.1"/>
    <path d="M5.6 18.4l2.1-2.1"/><path d="M16.3 7.7l2.1-2.1"/>
  </svg>
</template>
<script>
  (function() {
    var state = {
      executionId: null,
      slug: null,
      appName: 'App',
      runStatus: 'queued',
      items: [],
      displayMode: 'inline',
      selectedId: null,
    };
    var seenIds = Object.create(null);
    var savedFilmstripScroll = null;
    var root = document.getElementById('root');

    function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
    function applyDisplayMode() {
      document.body.classList.toggle('fullscreen', state.displayMode === 'fullscreen');
    }
    function isDetailView() {
      return state.displayMode === 'fullscreen' && state.selectedId !== null;
    }
    function isTerminal(s) {
      return s === 'completed' || s === 'failed' || s === 'cancelled';
    }
    // Stable id for the tile: prefer the source jobId; fall back to URL so
    // outputs without a jobId (inline-only nodes) still get a unique key.
    function idFor(item) { return item.jobId || item.assetUrl; }

    // ── Polling ──
    // Same self-driven postMessage loop the workflow widget uses. The HTTP
    // MCP server is stateless so we can't receive async progress; instead
    // the widget asks the host to call get_app_run every 2s and ingests
    // the result.
    var pollTimer = null;
    var pollAttempt = 0;
    var POLL_MS = 2000;
    var MAX_POLL_MS = 15 * 60 * 1000;

    function startPolling() {
      if (pollTimer || !state.executionId) return;
      pollAttempt = 0;
      pollOnce();
      pollTimer = setInterval(pollOnce, POLL_MS);
    }
    function stopPolling() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }
    function pollOnce() {
      pollAttempt++;
      if (pollAttempt * POLL_MS > MAX_POLL_MS) {
        stopPolling();
        return;
      }
      if (!state.executionId) return;
      var reqId = 'apprun-poll-' + state.executionId + '-' + pollAttempt;
      window.parent.postMessage({
        jsonrpc: '2.0', id: reqId,
        method: 'tools/call',
        params: { name: 'get_app_run', arguments: { execution_id: state.executionId } }
      }, '*');
    }
    window.addEventListener('message', function(ev) {
      var data = ev.data;
      if (!data || data.jsonrpc !== '2.0' || !data.id) return;
      if (typeof data.id !== 'string' || data.id.indexOf('apprun-poll-') !== 0) return;
      if (data.error) return;
      var sc = (data.result && data.result.structuredContent) || {};
      if (sc.status) state.runStatus = sc.status;

      // Append any new outputs we haven't seen yet. Dedupe on jobId|url.
      if (Array.isArray(sc.outputs)) {
        for (var i = 0; i < sc.outputs.length; i++) {
          var o = sc.outputs[i];
          if (!o || !o.url) continue;
          var key = (o.jobId || '') + '|' + o.url;
          if (seenIds[key]) continue;
          seenIds[key] = true;
          state.items.push({
            jobId: o.jobId || null,
            kind: o.kind,
            assetUrl: o.url,
            thumbnailUrl: o.url,
            prompt: o.prompt || '',
            model: o.model || '',
            createdAt: o.createdAt || '',
          });
        }
      }
      if (isTerminal(state.runStatus)) stopPolling();
      render();
    });

    // ── Host context ──
    window.addEventListener('mcp-ready', function(e) {
      var ctx = (e && e.detail) || window.__MCP_HOST_CONTEXT__ || {};
      if (ctx.displayMode) state.displayMode = ctx.displayMode;
      applyDisplayMode();
    });
    window.addEventListener('mcp-host-context-changed', function(e) {
      var ctx = (e.detail && e.detail.hostContext) || e.detail || {};
      if (ctx.displayMode) {
        var was = state.displayMode;
        state.displayMode = ctx.displayMode;
        if (was === 'fullscreen' && ctx.displayMode === 'inline') {
          state.selectedId = null;
        }
        applyDisplayMode();
        render();
      }
    });

    // ── Initial run context from run_app ──
    window.addEventListener('mcp-tool-result', function(e) {
      var sc = (e.detail && e.detail.structuredContent) || {};
      if (sc.executionId) state.executionId = sc.executionId;
      if (sc.slug) state.slug = sc.slug;
      if (sc.name) state.appName = sc.name;
      if (sc.status) state.runStatus = sc.status;
      render();
      startPolling();
    });

    // ── Render ──
    function render() {
      var existingStrip = root.querySelector('.filmstrip');
      if (existingStrip) savedFilmstripScroll = existingStrip.scrollLeft;
      clear(root);
      var card = document.createElement('div');
      card.className = 'card';

      // Status header — always visible, even in detail/fullscreen view.
      // In detail view we hide the grid section but keep the header
      // context above the preview is unnecessary; in detail we skip the
      // header altogether to avoid stealing vertical space (gallery does
      // the same).
      if (!isDetailView()) {
        card.appendChild(buildStatusRow());
      }

      if (isDetailView()) {
        renderDetail(card);
      } else {
        renderGrid(card);
      }
      root.appendChild(card);

      if (window.NodaroMCP && window.NodaroMCP.notifySizeChange) {
        window.NodaroMCP.notifySizeChange();
      }
    }

    function buildStatusRow() {
      var wrap = document.createElement('div');
      var row = document.createElement('div');
      row.className = 'status-row';
      var name = document.createElement('div');
      name.className = 'name';
      name.textContent = state.appName;
      var pill = document.createElement('div');
      var pillCls = state.runStatus === 'completed'
        ? 'done'
        : state.runStatus === 'failed' || state.runStatus === 'cancelled'
          ? 'failed'
          : state.runStatus === 'running'
            ? 'running'
            : 'queued';
      pill.className = 'pill ' + pillCls;
      var dot = document.createElement('span'); dot.className = 'dot';
      var label = document.createElement('span');
      label.textContent =
        state.runStatus === 'completed' ? 'Done · ' + state.items.length :
        state.runStatus === 'failed' ? 'Failed' :
        state.runStatus === 'cancelled' ? 'Cancelled' :
        state.runStatus === 'running' ? (state.items.length ? state.items.length + ' so far' : 'Running') :
        'Queued';
      pill.appendChild(dot);
      pill.appendChild(label);
      row.appendChild(name);
      row.appendChild(pill);
      wrap.appendChild(row);

      if (state.runStatus === 'running' || state.runStatus === 'queued') {
        var bar = document.createElement('div');
        bar.className = 'progress-bar';
        wrap.appendChild(bar);
      }
      return wrap;
    }

    function renderGrid(card) {
      if (!state.items.length) {
        var empty = document.createElement('div');
        empty.className = 'empty';
        var sparkTpl = document.getElementById('tpl-empty-spark');
        if (sparkTpl && sparkTpl.content) empty.appendChild(sparkTpl.content.cloneNode(true));
        var msg = document.createElement('div');
        msg.textContent = state.runStatus === 'failed'
          ? 'Run failed before producing any output.'
          : 'Outputs will appear here as the app produces them.';
        empty.appendChild(msg);
        card.appendChild(empty);
        return;
      }
      var grid = document.createElement('div');
      grid.className = 'grid';
      state.items.forEach(function(item) {
        grid.appendChild(buildTile(item));
      });
      card.appendChild(grid);
    }

    function buildTile(item) {
      var tile = document.createElement('div');
      tile.className = 'tile';
      tile.dataset.id = idFor(item);
      tile.addEventListener('click', function() {
        state.selectedId = idFor(item);
        if (window.NodaroMCP && window.NodaroMCP.requestDisplayMode) {
          window.NodaroMCP.requestDisplayMode('fullscreen').then(function(result) {
            var applied = (result && result.displayMode) || 'fullscreen';
            state.displayMode = applied;
            applyDisplayMode();
            render();
          });
        } else {
          state.displayMode = 'fullscreen';
          applyDisplayMode();
          render();
        }
      });

      if (item.kind === 'video') {
        var vid = document.createElement('video');
        vid.muted = true;
        vid.setAttribute('preload', 'metadata');
        vid.setAttribute('playsinline', '');
        vid.setAttribute('src', item.assetUrl);
        vid.addEventListener('loadedmetadata', function() {
          try { vid.currentTime = 0.001; } catch (_) {}
        });
        tile.appendChild(vid);
      } else if (item.kind === 'audio') {
        var audioTpl = document.getElementById('tpl-audio-tile');
        if (audioTpl && audioTpl.content) {
          var node = audioTpl.content.cloneNode(true);
          var label = node.querySelector('.audio-label');
          if (label) label.textContent = item.prompt || item.model || 'Audio';
          tile.appendChild(node);
        }
      } else {
        var img = document.createElement('img');
        img.setAttribute('src', item.thumbnailUrl || item.assetUrl);
        img.setAttribute('alt', '');
        img.setAttribute('loading', 'lazy');
        tile.appendChild(img);
      }

      var overlay = document.createElement('div');
      overlay.className = 'hover-overlay';
      var useBtn = document.createElement('div');
      useBtn.className = 'use';
      useBtn.textContent = 'Use';
      useBtn.addEventListener('click', function(ev) {
        ev.stopPropagation();
        if (!window.NodaroMCP.pushUserMessage) return;
        var ref = item.jobId
          ? 'the ' + item.kind + ' with id ' + item.jobId
          : 'this ' + item.kind + ' at ' + item.assetUrl;
        window.NodaroMCP.pushUserMessage(
          'Use ' + ref + ' as a reference. The user clicked the Use button.' +
          '\\n[loop ask me using q/a as needed]'
        );
      });
      overlay.appendChild(useBtn);

      var dlBtn = document.createElement('div');
      dlBtn.className = 'tile-download';
      dlBtn.title = 'Download';
      dlBtn.setAttribute('aria-label', 'Download');
      var dlTpl = document.getElementById('tpl-download-icon');
      if (dlTpl && dlTpl.content) dlBtn.appendChild(dlTpl.content.cloneNode(true));
      dlBtn.addEventListener('click', function(ev) {
        ev.stopPropagation();
        if (window.NodaroMCP && window.NodaroMCP.openLink) {
          window.NodaroMCP.openLink(item.assetUrl);
        }
      });
      overlay.appendChild(dlBtn);

      tile.appendChild(overlay);
      return tile;
    }

    function renderDetail(card) {
      var idx = state.items.findIndex(function(it) { return idFor(it) === state.selectedId; });
      var item = idx >= 0 ? state.items[idx] : null;
      if (!item) { state.selectedId = null; render(); return; }

      var preview = document.createElement('div');
      preview.className = 'preview';

      var navPrev = document.createElement('button');
      navPrev.className = 'nav-arrow prev';
      navPrev.title = 'Previous';
      navPrev.setAttribute('aria-label', 'Previous');
      var prevIconN = document.getElementById('tpl-chev-left');
      if (prevIconN && prevIconN.content) navPrev.appendChild(prevIconN.content.cloneNode(true));
      navPrev.disabled = state.items.length <= 1;
      navPrev.addEventListener('click', function() {
        var n = state.items.length;
        if (n <= 1) return;
        var nextIdx = (idx - 1 + n) % n;
        state.selectedId = idFor(state.items[nextIdx]);
        render();
      });
      preview.appendChild(navPrev);

      var navNext = document.createElement('button');
      navNext.className = 'nav-arrow next';
      navNext.title = 'Next';
      navNext.setAttribute('aria-label', 'Next');
      var nextIconN = document.getElementById('tpl-chev-right');
      if (nextIconN && nextIconN.content) navNext.appendChild(nextIconN.content.cloneNode(true));
      navNext.disabled = state.items.length <= 1;
      navNext.addEventListener('click', function() {
        var n = state.items.length;
        if (n <= 1) return;
        var nextIdx = (idx + 1) % n;
        state.selectedId = idFor(state.items[nextIdx]);
        render();
      });
      preview.appendChild(navNext);

      var media;
      if (item.kind === 'video') {
        media = document.createElement('video');
        media.controls = true;
        media.setAttribute('preload', 'metadata');
        media.setAttribute('playsinline', '');
      } else if (item.kind === 'audio') {
        media = document.createElement('audio');
        media.controls = true;
        media.setAttribute('preload', 'metadata');
      } else {
        media = document.createElement('img');
        media.setAttribute('alt', '');
      }
      media.setAttribute('src', item.assetUrl);
      preview.appendChild(media);

      // Touch swipe navigation — same threshold as gallery.
      var touchStartX = 0, touchStartY = 0, touchActive = false;
      preview.addEventListener('touchstart', function(ev) {
        if (state.items.length <= 1) return;
        var t = ev.changedTouches && ev.changedTouches[0];
        if (!t) return;
        touchActive = true;
        touchStartX = t.clientX;
        touchStartY = t.clientY;
      }, { passive: true });
      preview.addEventListener('touchend', function(ev) {
        if (!touchActive || state.items.length <= 1) { touchActive = false; return; }
        touchActive = false;
        var t = ev.changedTouches && ev.changedTouches[0];
        if (!t) return;
        var dx = t.clientX - touchStartX;
        var dy = t.clientY - touchStartY;
        if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        var n = state.items.length;
        var nextIdx = dx > 0
          ? (idx - 1 + n) % n
          : (idx + 1) % n;
        state.selectedId = idFor(state.items[nextIdx]);
        render();
      }, { passive: true });

      card.appendChild(preview);

      // Meta — model + date badges (no aspect_ratio/resolution because
      // get_app_run doesn't carry those; users can dive into the full
      // gallery for the full breakdown).
      var meta = document.createElement('div');
      meta.className = 'meta';
      var metaLeft = document.createElement('div');
      metaLeft.className = 'meta-left';
      if (item.model) {
        var modelBadge = document.createElement('span');
        modelBadge.className = 'badge';
        modelBadge.textContent = item.model;
        metaLeft.appendChild(modelBadge);
      }
      meta.appendChild(metaLeft);
      if (item.createdAt) {
        var dateBadge = document.createElement('span');
        dateBadge.className = 'badge meta-date';
        dateBadge.textContent = (item.createdAt || '').slice(0, 10);
        meta.appendChild(dateBadge);
      }
      card.appendChild(meta);

      // Filmstrip — same treatment as gallery: only when more than one item.
      if (state.items.length > 1) {
        var strip = document.createElement('div');
        strip.className = 'filmstrip';
        state.items.forEach(function(it) {
          var stripItem = document.createElement('div');
          stripItem.className = 'strip-item' + (idFor(it) === idFor(item) ? ' active' : '');
          if (it.kind === 'audio' || (!it.thumbnailUrl && !it.assetUrl)) {
            var glyph = document.createElement('div');
            glyph.className = 'strip-audio';
            glyph.textContent = it.kind === 'audio' ? '♫' : '▶';
            stripItem.appendChild(glyph);
          } else {
            var sImg = document.createElement('img');
            sImg.setAttribute('src', it.thumbnailUrl || it.assetUrl);
            sImg.setAttribute('alt', '');
            sImg.setAttribute('loading', 'lazy');
            stripItem.appendChild(sImg);
          }
          stripItem.addEventListener('click', function() {
            state.selectedId = idFor(it);
            render();
          });
          strip.appendChild(stripItem);
        });
        card.appendChild(strip);
        setTimeout(function() {
          if (savedFilmstripScroll !== null) {
            strip.scrollLeft = savedFilmstripScroll;
          }
          var active = strip.querySelector('.strip-item.active');
          if (!active || !active.scrollIntoView) return;
          var stripRect = strip.getBoundingClientRect();
          var activeRect = active.getBoundingClientRect();
          var visible = activeRect.left >= stripRect.left && activeRect.right <= stripRect.right;
          if (!visible) {
            active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
          }
        }, 0);
      }

      // Actions — kind-specific Animate/Edit/etc on left, Copy/Download/
      // Recreate on right. Mirrors gallery + single-job widget.
      var actions = document.createElement('div');
      actions.className = 'actions';
      var actionsLeft = document.createElement('div');
      actionsLeft.className = 'actions-left';
      actions.appendChild(actionsLeft);

      function makeTextBtn(label, iconTplId, onClick) {
        var b = document.createElement('button');
        b.type = 'button';
        b.title = label;
        if (iconTplId) {
          var tpl = document.getElementById(iconTplId);
          if (tpl && tpl.content) b.appendChild(tpl.content.cloneNode(true));
        }
        var span = document.createElement('span');
        span.textContent = label;
        b.appendChild(span);
        b.addEventListener('click', onClick);
        return b;
      }
      function closeFullscreen() {
        if (window.NodaroMCP && window.NodaroMCP.requestDisplayMode) {
          window.NodaroMCP.requestDisplayMode('inline');
        } else {
          state.displayMode = 'inline';
          state.selectedId = null;
          applyDisplayMode();
          render();
        }
      }
      function pushFollowup(prefix, action) {
        if (!window.NodaroMCP || !window.NodaroMCP.pushUserMessage) return;
        var ctx = {
          asset_url: item.assetUrl,
          'original prompt': item.prompt,
          model: item.model,
          action: action,
        };
        window.NodaroMCP.pushUserMessage(
          prefix + ': ' + JSON.stringify(ctx) +
          '\\n[loop ask me using q/a as needed]'
        );
        closeFullscreen();
      }

      if (item.kind === 'image') {
        actionsLeft.appendChild(makeTextBtn('Animate', 'tpl-icon-play', function() {
          pushFollowup('animate this image', 'animate_image');
        }));
        actionsLeft.appendChild(makeTextBtn('Edit', 'tpl-icon-edit', function() {
          pushFollowup('modify this image', 'modify_image');
        }));
      } else if (item.kind === 'video') {
        actionsLeft.appendChild(makeTextBtn('Edit', 'tpl-icon-edit', function() {
          pushFollowup('edit this video', 'modify_video');
        }));
      }

      var actionsRight = document.createElement('div');
      actionsRight.className = 'actions-right';
      actions.appendChild(actionsRight);
      function makeIconBtn(title, tplId, onClick) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'icon-btn';
        b.title = title;
        b.setAttribute('aria-label', title);
        var tpl = document.getElementById(tplId);
        if (tpl && tpl.content) b.appendChild(tpl.content.cloneNode(true));
        b.addEventListener('click', onClick);
        return b;
      }
      actionsRight.appendChild(makeIconBtn('Copy prompt', 'tpl-icon-copy', function() {
        if (!item.prompt) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(item.prompt).catch(function() {});
        }
      }));
      actionsRight.appendChild(makeIconBtn('Download', 'tpl-download-icon', function() {
        if (window.NodaroMCP && window.NodaroMCP.openLink) {
          window.NodaroMCP.openLink(item.assetUrl);
        }
      }));
      actionsRight.appendChild(makeIconBtn('Recreate', 'tpl-icon-recreate', function() {
        // Recreate for an app run = re-run the same app slug. Saner than
        // sending the raw prompt (which may not even be the user-facing
        // intent for a multi-node app).
        if (!window.NodaroMCP || !window.NodaroMCP.pushUserMessage) return;
        if (state.slug) {
          window.NodaroMCP.pushUserMessage('run the ' + state.slug + ' app again');
          closeFullscreen();
        } else if (item.prompt) {
          window.NodaroMCP.pushUserMessage(item.prompt);
          closeFullscreen();
        }
      }));

      card.appendChild(actions);
    }

    // Keyboard navigation in fullscreen detail view: arrows + escape.
    document.addEventListener('keydown', function(ev) {
      if (!isDetailView()) return;
      var t = ev.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || (t.isContentEditable))) return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        if (window.NodaroMCP && window.NodaroMCP.requestDisplayMode) {
          window.NodaroMCP.requestDisplayMode('inline');
        } else {
          state.displayMode = 'inline';
          state.selectedId = null;
          applyDisplayMode();
          render();
        }
        return;
      }
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      ev.preventDefault();
      var n = state.items.length;
      if (n <= 1) return;
      var idx = state.items.findIndex(function(it) { return idFor(it) === state.selectedId; });
      if (idx < 0) return;
      var nextIdx = ev.key === 'ArrowLeft'
        ? (idx - 1 + n) % n
        : (idx + 1) % n;
      state.selectedId = idFor(state.items[nextIdx]);
      render();
    });
  })();
</script>
</body></html>`
}

export interface AppRunInitData {
  executionId: string
  slug?: string
  name?: string
  status?: string
}

export const buildAppRunWidget = (_d?: AppRunInitData): string =>
  buildAppRunWidgetTemplate()
