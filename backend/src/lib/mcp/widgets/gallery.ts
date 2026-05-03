/**
 * Gallery widget — paginated grid + per-thumbnail Use button + fullscreen
 * detail view. Static template registered at `ui://nodaro/widget/gallery`.
 *
 * Per-call data (the gallery items) arrives via
 * `ui/notifications/tool-result` as structuredContent: { items, nextCursor,
 * totalCount }.
 *
 * DOM-construction safety: `document.createElement` + `textContent` +
 * `setAttribute` only.
 */
import { uiProtocolShim } from "./_common.js"

const GALLERY_CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 12px; font: 13px system-ui, sans-serif; background: transparent; color: inherit; }
  /* Card shell — subtle border + tinted bg + rounded corners frame
     the gallery as a discrete widget against the host chat (matches
     [redacted-reference]'s grid-shell pattern + our single-job widget). */
  .card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    border: 1px solid rgba(127,127,127,0.18);
    background: rgba(127,127,127,0.04);
    border-radius: 14px;
    padding: 12px;
  }
  /* Header row — small label + count on left, the count helps the
     user gauge how much they have ([redacted-reference]'s "Generations" title
     pattern, but with a count). */
  .header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .header .title { font-size: 13px; font-weight: 600; opacity: 0.85; }
  .header .count { font-size: 11px; opacity: 0.6; }
  /* Grid density — minmax(140px, 1fr). 100px was too small (tiles
     squished, ref overlays barely visible). 140 lets 3-up fit on a
     standard 480px chat width with comfortable thumb-tap targets. */
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
  .tile { position: relative; aspect-ratio: 1/1; border-radius: 8px; overflow: hidden; background: rgba(0,0,0,0.05); cursor: pointer; }
  .tile img, .tile video { width: 100%; height: 100%; object-fit: cover; display: block; }
  /* Hover overlay — Use pill stretches to fill the bottom width, with
     a fixed-size Download icon hugging the right edge (matches
     [redacted-reference]'s hover layout). Aligned to the BOTTOM of the tile so
     the buttons sit over the dark gradient and don't obscure the
     image content. Hidden on touch devices (no hover) because the
     invisible-but-clickable overlay was grabbing taps meant to open
     the tile. */
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
  /* Use takes all the remaining width — [redacted-reference]'s full-width Use
     pill. Centered text. Subtle bg-darken on hover (no scale — would
     look weird on a stretched button). */
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
    /* Card shell is mobile-only — on desktop the gallery sits flush
       in the chat without the tinted box. Matches the single-job
       widget's desktop treatment. */
    .card {
      border: 0;
      background: transparent;
      border-radius: 0;
      padding: 0;
    }
  }
  /* Pagination — [redacted-reference]-style pill: prev chevron, dots, next chevron.
     Whole control sits in a single rounded shell so it reads as ONE
     widget instead of three. */
  .pagination {
    display: flex; align-items: center; justify-content: center; gap: 4px;
    margin-top: 4px;
  }
  .pagination .dots { display: flex; gap: 6px; padding: 4px 6px; align-items: center; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: rgba(127,127,127,0.35); cursor: pointer; transition: background .15s, transform .15s; }
  .dot.active { background: currentColor; transform: scale(1.4); }
  .pag-btn {
    display: flex; align-items: center; justify-content: center;
    width: 30px; height: 30px;
    border: 0; background: rgba(127,127,127,0.08); color: inherit;
    border-radius: 50%; cursor: pointer; opacity: 0.85;
    transition: opacity .15s, background .15s;
  }
  .pag-btn:hover:not(:disabled) { opacity: 1; background: rgba(127,127,127,0.18); }
  .pag-btn:disabled { opacity: 0.35; cursor: default; background: transparent; }
  .pag-btn svg { display: block; width: 16px; height: 16px; stroke-width: 2.5; }
  .footer { opacity: 0.6; font-size: 11px; text-align: center; }
  .empty { text-align: center; padding: 32px 0; opacity: 0.7; }
  /* Reference-asset overlay — small chained thumbnails in the tile's
     top-right showing what fed this generation ([redacted-reference]'s lineage
     pattern). Up to 2 visible; if more exist a "+N" pill caps them. */
  .refs {
    position: absolute;
    top: 4px; right: 4px;
    display: flex;
    gap: 2px;
    pointer-events: none;
  }
  .refs > .ref {
    width: 22px; height: 22px;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid rgba(255,255,255,0.6);
    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    background: rgba(0,0,0,0.2);
  }
  .refs > .ref img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .refs > .ref-more {
    width: 22px; height: 22px;
    border-radius: 4px;
    background: rgba(0,0,0,0.6);
    color: #fff;
    font-size: 10px;
    font-weight: 600;
    display: flex; align-items: center; justify-content: center;
    border: 1px solid rgba(255,255,255,0.6);
    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
  }
  /* Audio tile: <audio> has no visual thumbnail and <img src=mp3> renders
     a broken-image glyph. Replace with an icon + clamped label tile so
     the kind reads at-a-glance and the prompt hint shows underneath. */
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
  /* Detail view — wraps inside the same card shell as the grid view.
     Padding is on the inner stack so the back button hugs the top-left
     of the card, no extra inset. */
  .detail { display: flex; flex-direction: column; gap: 12px; }
  .detail .preview { width: 100%; max-height: 60vh; display: flex; align-items: center; justify-content: center; }
  .detail .preview img, .detail .preview video, .detail .preview audio { width: 100%; height: auto; max-height: 60vh; object-fit: contain; border-radius: 8px; }
  /* Filmstrip — horizontal-scrolling row of small thumbnails to
     navigate between generations without going back to the grid.
     Active item bordered in brand pink. */
  .filmstrip {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 4px 2px;
    scrollbar-width: thin;
  }
  .filmstrip::-webkit-scrollbar { height: 6px; }
  .filmstrip::-webkit-scrollbar-thumb { background: rgba(127,127,127,0.3); border-radius: 3px; }
  .filmstrip .strip-item {
    flex: 0 0 auto;
    width: 40px; height: 40px;
    border-radius: 6px;
    overflow: hidden;
    background: rgba(0,0,0,0.05);
    cursor: pointer;
    border: 2px solid transparent;
    transition: border-color .15s, transform .15s;
  }
  .filmstrip .strip-item:hover { transform: scale(1.05); }
  .filmstrip .strip-item.active { border-color: #ff0073; }
  .filmstrip .strip-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
  /* Audio strip-item: same visual treatment as the grid audio tile. */
  .filmstrip .strip-audio {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(135deg, rgba(91,157,255,0.18), rgba(142,107,255,0.18));
    color: rgba(127,127,127,0.85);
    font-size: 14px;
  }
  .detail .meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 12px; opacity: 0.75; }
  .detail .meta .badge { background: rgba(127,127,127,0.15); padding: 2px 8px; border-radius: 4px; }
  /* Action row — left text buttons (Animate / Edit / Suno follow-ups),
     right icon-only utilities (Copy / Download / Recreate). Mirrors the
     single-job widget shape exactly so detail view feels like the same
     surface as a freshly-generated asset. */
  .detail .actions { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .actions-left, .actions-right { display: flex; align-items: center; }
  .actions-left { gap: 8px; }
  .actions-right { gap: 2px; }
  /* Borderless action buttons — same calm Claude-style affordance the
     single-job widget uses. Subtle dim → bright on hover. */
  button { padding: 6px 12px; border: none; background: transparent; color: inherit; border-radius: 6px; font-size: 13px; cursor: pointer; opacity: 0.7; transition: opacity .15s, background .15s, color .15s; font-family: inherit; line-height: 1; display: inline-flex; align-items: center; gap: 6px; }
  button:hover { background: rgba(127,127,127,0.1); opacity: 1; }
  /* Icon-only utility buttons (copy / download / recreate). Tighter padding. */
  button.icon-btn { padding: 6px; gap: 0; opacity: 0.6; }
  button.icon-btn:hover { opacity: 1; }
  button.icon-btn svg { display: block; width: 14px; height: 14px; }
  button svg.lead { display: block; width: 12px; height: 12px; }
  /* Fullscreen mode — when the host promotes the iframe to fullscreen
     (after a tile tap), strip card chrome and use flex layout so the
     preview auto-fills available space while the bottom rows
     (filmstrip + meta + actions) keep their natural height. No
     scrolling — everything fits in the viewport.
     Top padding clears the host's mobile chrome (menu bar). 40px is
     enough on Claude.ai mobile (90px earlier was overkill and pushed
     the bottom rows below the chat input). Desktop drops to 0 via
     the hover:hover override. */
  :root { --fs-top-pad: 40px; }
  body.fullscreen { padding: var(--fs-top-pad) 0 0 0; margin: 0; height: 100dvh; overflow: hidden; }
  body.fullscreen .card {
    height: calc(100dvh - var(--fs-top-pad));
    display: flex;
    flex-direction: column;
    border: 0;
    background: transparent;
    padding: 8px 12px;
    border-radius: 0;
    gap: 8px;
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
  /* Prev/Next nav arrows OVERLAYING the preview on left/right edges.
     Only visible in fullscreen detail view. */
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
    /* Desktop hosts overlay the close affordance instead of fixing a
       header bar — drop the mobile top inset. */
    :root { --fs-top-pad: 0px; }
  }
`

export function buildGalleryWidgetTemplate(): string {
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8" />
<style>${GALLERY_CSS}</style>
${uiProtocolShim()}
</head>
<body>
<div id="root"><div class="empty">Loading…</div></div>
<!-- Static SVG template so the per-tile script can clone .content
     instead of using createElementNS or innerHTML. -->
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
<template id="tpl-icon-external">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/>
    <line x1="10" y1="14" x2="21" y2="3"/>
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
<script>
  (function() {
    var ITEMS_PER_PAGE = 12;
    var data = { items: [], nextCursor: null, totalCount: 0 };
    // displayMode tracks the host iframe's current size mode (inline vs
    // fullscreen). The detail view is FULLSCREEN-ONLY (matches [redacted-reference]
    // and our single-job widget). When the host returns the iframe to
    // inline (user closes via X overlay), selectedId clears and we render
    // the grid again.
    var state = { page: 0, displayMode: 'inline', selectedId: null };
    var loadingMore = false;
    var loadMoreReqCounter = 0;
    var root = document.getElementById('root');

    // Fetch the next page of older items using the cursor returned by
    // a prior browse_gallery result. Fires a widget-initiated
    // tools/call (matched by id prefix loadmore-), appends fresh items
    // to data.items (deduped), advances state.page so the user lands on
    // the new content. Same self-driven postMessage trick the
    // single-job widget uses for its get_asset polling loop.
    function loadMoreItems() {
      if (loadingMore || !data.nextCursor) return;
      loadingMore = true;
      var reqId = 'loadmore-' + (++loadMoreReqCounter);
      var to = setTimeout(function() {
        window.removeEventListener('message', handler);
        loadingMore = false;
        render();
      }, 30000);
      function handler(ev) {
        var msg = ev.data;
        if (!msg || msg.jsonrpc !== '2.0' || msg.id !== reqId) return;
        clearTimeout(to);
        window.removeEventListener('message', handler);
        loadingMore = false;
        if (msg.error) { render(); return; }
        var sc = (msg.result && msg.result.structuredContent) || {};
        if (Array.isArray(sc.items) && sc.items.length > 0) {
          // Dedupe by jobId — server might overlap if cursor is a
          // timestamp and multiple jobs share completed_at.
          var existing = new Set();
          for (var i = 0; i < data.items.length; i++) existing.add(data.items[i].jobId);
          var fresh = [];
          for (var j = 0; j < sc.items.length; j++) {
            if (!existing.has(sc.items[j].jobId)) fresh.push(sc.items[j]);
          }
          data.items = data.items.concat(fresh);
        }
        // nextCursor may be undefined (no more) or a new value.
        data.nextCursor = (typeof sc.nextCursor !== 'undefined') ? sc.nextCursor : null;
        if (typeof sc.totalCount === 'number') data.totalCount = sc.totalCount;
        // Advance into the newly-loaded page (capped to last page).
        var newTotalPages = Math.max(1, Math.ceil(data.items.length / ITEMS_PER_PAGE));
        state.page = Math.min(state.page + 1, newTotalPages - 1);
        render();
      }
      window.addEventListener('message', handler);
      window.parent.postMessage({
        jsonrpc: '2.0', id: reqId,
        method: 'tools/call',
        params: { name: 'browse_gallery', arguments: { cursor: data.nextCursor } }
      }, '*');
      render(); // re-render to show "loading" disabled state
    }

    function applyDisplayMode() {
      document.body.classList.toggle('fullscreen', state.displayMode === 'fullscreen');
    }
    // Initial host context (from the ui/initialize handshake).
    window.addEventListener('mcp-ready', function(e) {
      var ctx = (e && e.detail) || window.__MCP_HOST_CONTEXT__ || {};
      if (ctx.displayMode) state.displayMode = ctx.displayMode;
      applyDisplayMode();
    });
    // Host-driven changes (user closes fullscreen via the host's X overlay).
    window.addEventListener('mcp-host-context-changed', function(e) {
      var ctx = (e.detail && e.detail.hostContext) || e.detail || {};
      if (ctx.displayMode) {
        var was = state.displayMode;
        state.displayMode = ctx.displayMode;
        // Closing fullscreen returns us to the grid — clear the selection.
        if (was === 'fullscreen' && ctx.displayMode === 'inline') {
          state.selectedId = null;
        }
        applyDisplayMode();
        render();
      }
    });

    function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

    // Detail view shows ONLY when fullscreen mode is active AND a tile
    // has been selected. Anywhere else (inline mode, no selection)
    // shows the grid.
    function isDetailView() {
      return state.displayMode === 'fullscreen' && state.selectedId !== null;
    }

    function render() {
      clear(root);
      if (!data.items.length) {
        var empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No items yet.';
        root.appendChild(empty);
      } else if (isDetailView()) {
        renderDetail();
      } else {
        renderGrid();
      }
      // View transitions (grid → detail and back) change body height
      // significantly. Force a size emit so the host shrinks/grows the
      // iframe to fit the new content instead of leaving stale chrome.
      if (window.NodaroMCP && window.NodaroMCP.notifySizeChange) {
        window.NodaroMCP.notifySizeChange();
      }
    }

    function renderGrid() {
      var totalPages = Math.max(1, Math.ceil(data.items.length / ITEMS_PER_PAGE));
      var start = state.page * ITEMS_PER_PAGE;
      var pageItems = data.items.slice(start, start + ITEMS_PER_PAGE);

      // Card shell — wraps everything (header + grid + pagination + footer).
      var card = document.createElement('div');
      card.className = 'card';

      // Header row: "Gallery" title + item-count subtitle. Establishes
      // the widget identity inside the host chat ([redacted-reference] uses the
      // same pattern with a "Generations" title).
      var header = document.createElement('div');
      header.className = 'header';
      var title = document.createElement('div');
      title.className = 'title';
      title.textContent = 'Gallery';
      var count = document.createElement('div');
      count.className = 'count';
      count.textContent =
        data.items.length +
        (data.nextCursor ? ' shown · ' + data.totalCount + '+ total' : ' total');
      header.appendChild(title);
      header.appendChild(count);
      card.appendChild(header);

      var grid = document.createElement('div');
      grid.className = 'grid';
      pageItems.forEach(function(item) {
        var tile = document.createElement('div');
        tile.className = 'tile';
        tile.dataset.id = item.jobId;
        tile.addEventListener('click', function() {
          state.selectedId = item.jobId;
          // Promote to fullscreen — detail view is fullscreen-only,
          // matching [redacted-reference] + our single-job widget. Trust the host's
          // applied mode (some hosts may reject fullscreen and stay
          // inline; the displayMode-changed listener catches that).
          if (window.NodaroMCP && window.NodaroMCP.requestDisplayMode) {
            window.NodaroMCP.requestDisplayMode('fullscreen').then(function(result) {
              var applied = (result && result.displayMode) || 'fullscreen';
              state.displayMode = applied;
              applyDisplayMode();
              render();
            });
          } else {
            // Standalone / non-Apps client — render the detail inline.
            state.displayMode = 'fullscreen';
            applyDisplayMode();
            render();
          }
        });

        if (item.kind === 'video') {
          // If the backend has a thumbnail URL, render it as an <img>
          // (cleanest result — no play-button overlay, no decoder cost).
          // Otherwise fall back to a <video> element with preload metadata
          // and a forced seek to the first frame so the tile shows the
          // actual frame instead of the browser's blank/play-button
          // poster. playsinline keeps iOS Safari from auto-launching the
          // native fullscreen player when the iframe scrolls into view.
          var media;
          if (item.thumbnailUrl) {
            media = document.createElement('img');
            media.setAttribute('src', item.thumbnailUrl);
            media.setAttribute('alt', '');
            media.setAttribute('loading', 'lazy');
          } else {
            media = document.createElement('video');
            media.muted = true;
            media.setAttribute('preload', 'metadata');
            media.setAttribute('playsinline', '');
            media.setAttribute('src', item.assetUrl);
            media.addEventListener('loadedmetadata', function() {
              try { media.currentTime = 0.001; } catch (e) {}
            });
          }
          tile.appendChild(media);
        } else if (item.kind === 'audio') {
          // Audio has no visual thumbnail; previously fell through to
          // <img src=audio.mp3> which rendered as a broken image glyph.
          // Render an icon + prompt-label tile instead.
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

        // Reference-asset overlay: small chained thumbnails in the
        // top-right showing what fed this generation. Up to 2 visible;
        // a "+N" pill caps the rest. Skips when there are no refs (e.g.
        // text-to-image with no reference). Pointer-events:none so it
        // doesn't intercept the tile tap.
        if (Array.isArray(item.references) && item.references.length > 0) {
          var refsWrap = document.createElement('div');
          refsWrap.className = 'refs';
          var visible = item.references.slice(0, 2);
          var extra = item.references.length - visible.length;
          visible.forEach(function(refUrl) {
            var ref = document.createElement('div');
            ref.className = 'ref';
            var refImg = document.createElement('img');
            refImg.setAttribute('src', refUrl);
            refImg.setAttribute('alt', '');
            refImg.setAttribute('loading', 'lazy');
            ref.appendChild(refImg);
            refsWrap.appendChild(ref);
          });
          if (extra > 0) {
            var more = document.createElement('div');
            more.className = 'ref-more';
            more.textContent = '+' + extra;
            refsWrap.appendChild(more);
          }
          tile.appendChild(refsWrap);
        }

        // Hover overlay: gradient at bottom + Use pill (centered) +
        // Download icon (right). Both stop propagation so a tap on the
        // overlay doesn't open the detail view.
        var overlay = document.createElement('div');
        overlay.className = 'hover-overlay';

        var useBtn = document.createElement('div');
        useBtn.className = 'use';
        useBtn.textContent = 'Use';
        useBtn.addEventListener('click', function(ev) {
          ev.stopPropagation();
          // Same wording + Q&A trailer as the detail-view "Use as
          // reference" button. Bypasses the shim's useAsset() helper
          // (which has no trailer) so both Use paths land an identical
          // message in chat.
          if (window.NodaroMCP.pushUserMessage) {
            window.NodaroMCP.pushUserMessage(
              'Use the ' + item.kind + ' with id ' + item.jobId +
              ' as a reference. The user clicked the Use button.' +
              // Source double-backslash-n; the TS template literal
              // collapses it so the rendered JS gets a literal \\n
              // escape inside the single-quoted string. (Raw newline
              // would break the string; see widgets/_common.ts notes.)
              '\\n[loop ask me using q/a as needed]'
            );
          }
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
        grid.appendChild(tile);
      });
      // Pad incomplete final page with invisible placeholder tiles so
      // the grid keeps the same height across pages — without this the
      // last page (e.g. 4 items in a 12-slot grid) shrinks vertically
      // and the pagination row jumps up. Placeholders are aria-hidden +
      // pointer-events:none so they don't capture taps or trip a11y.
      for (var pad = pageItems.length; pad < ITEMS_PER_PAGE; pad++) {
        var placeholder = document.createElement('div');
        placeholder.className = 'tile';
        placeholder.style.visibility = 'hidden';
        placeholder.style.pointerEvents = 'none';
        placeholder.setAttribute('aria-hidden', 'true');
        grid.appendChild(placeholder);
      }
      card.appendChild(grid);

      // Pagination — only render when more than one page. Single-page
      // gallery doesn't need the chrome (was just a single dot).
      if (totalPages > 1) {
        var pagination = document.createElement('div');
        pagination.className = 'pagination';
        var prev = document.createElement('button');
        prev.className = 'pag-btn';
        prev.title = 'Previous page';
        prev.setAttribute('aria-label', 'Previous page');
        prev.disabled = state.page === 0;
        var prevIcon = document.getElementById('tpl-chev-left');
        if (prevIcon && prevIcon.content) prev.appendChild(prevIcon.content.cloneNode(true));
        prev.addEventListener('click', function() {
          if (state.page > 0) { state.page--; render(); }
        });
        pagination.appendChild(prev);

        var dotsWrap = document.createElement('div');
        dotsWrap.className = 'dots';
        for (var i = 0; i < totalPages; i++) {
          var dot = document.createElement('div');
          dot.className = 'dot' + (i === state.page ? ' active' : '');
          dot.dataset.page = String(i);
          ;(function(idx) { dot.addEventListener('click', function() { state.page = idx; render(); }); })(i);
          dotsWrap.appendChild(dot);
        }
        pagination.appendChild(dotsWrap);

        var next = document.createElement('button');
        next.className = 'pag-btn';
        next.title = data.nextCursor && state.page === totalPages - 1
          ? 'Load older items'
          : 'Next page';
        next.setAttribute('aria-label', next.title);
        // Enabled when there's another local page OR a server cursor
        // pointing to older items we haven't fetched yet.
        var canNext = state.page < totalPages - 1 || !!data.nextCursor;
        next.disabled = !canNext || loadingMore;
        var nextIcon = document.getElementById('tpl-chev-right');
        if (nextIcon && nextIcon.content) next.appendChild(nextIcon.content.cloneNode(true));
        next.addEventListener('click', function() {
          if (state.page < totalPages - 1) {
            state.page++;
            render();
          } else if (data.nextCursor) {
            loadMoreItems();
          }
        });
        pagination.appendChild(next);

        card.appendChild(pagination);
      }

      // Footer kept for the "more available" hint on cursor pages.
      if (data.nextCursor) {
        var footer = document.createElement('div');
        footer.className = 'footer';
        footer.textContent = 'More available — refine the search to load older items';
        card.appendChild(footer);
      }

      root.appendChild(card);
    }

    function renderDetail() {
      var idx = data.items.findIndex(function(it) { return it.jobId === state.selectedId; });
      var item = idx >= 0 ? data.items[idx] : null;
      if (!item) { state.selectedId = null; render(); return; }

      // No back-row header — the host already shows its own brand+X
      // close above the iframe in fullscreen mode ([redacted-reference] matches
      // this; we mirror). Detail starts directly with the preview.
      var card = document.createElement('div');
      card.className = 'card';

      var preview = document.createElement('div');
      preview.className = 'preview';

      // Prev/Next nav arrows overlaying the preview — switch the
      // selected item. Wrap-around at the ends (matches asset
      // browsers / [redacted-reference] filmstrip behavior).
      var navPrev = document.createElement('button');
      navPrev.className = 'nav-arrow prev';
      navPrev.title = 'Previous';
      navPrev.setAttribute('aria-label', 'Previous');
      var prevIconN = document.getElementById('tpl-chev-left');
      if (prevIconN && prevIconN.content) navPrev.appendChild(prevIconN.content.cloneNode(true));
      navPrev.disabled = data.items.length <= 1;
      navPrev.addEventListener('click', function() {
        var n = data.items.length;
        if (n <= 1) return;
        var nextIdx = (idx - 1 + n) % n;
        state.selectedId = data.items[nextIdx].jobId;
        render();
      });
      preview.appendChild(navPrev);

      var navNext = document.createElement('button');
      navNext.className = 'nav-arrow next';
      navNext.title = 'Next';
      navNext.setAttribute('aria-label', 'Next');
      var nextIconN = document.getElementById('tpl-chev-right');
      if (nextIconN && nextIconN.content) navNext.appendChild(nextIconN.content.cloneNode(true));
      navNext.disabled = data.items.length <= 1;
      navNext.addEventListener('click', function() {
        var n = data.items.length;
        if (n <= 1) return;
        var nextIdx = (idx + 1) % n;
        state.selectedId = data.items[nextIdx].jobId;
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
      card.appendChild(preview);

      // Filmstrip — horizontal-scrolling row of all gallery items so the
      // user can switch between assets without going back to grid.
      // Only render when there's more than one item (otherwise it's a
      // sad little 1-thumb sliver).
      if (data.items.length > 1) {
        var strip = document.createElement('div');
        strip.className = 'filmstrip';
        data.items.forEach(function(it) {
          var stripItem = document.createElement('div');
          stripItem.className = 'strip-item' + (it.jobId === item.jobId ? ' active' : '');
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
            state.selectedId = it.jobId;
            render();
          });
          strip.appendChild(stripItem);
        });
        card.appendChild(strip);
        // Auto-scroll the active item into view (centered) after mount.
        setTimeout(function() {
          var active = strip.querySelector('.strip-item.active');
          if (active && active.scrollIntoView) {
            active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
          }
        }, 0);
      }

      // Compact metadata badges — model + aspect (best-effort) + date.
      // Replaces the previous prose lines with the same shape as
      // single-job widget badges.
      var meta = document.createElement('div');
      meta.className = 'meta';
      var modelBadge = document.createElement('span');
      modelBadge.className = 'badge';
      modelBadge.textContent = item.model || 'unknown model';
      meta.appendChild(modelBadge);
      if (item.createdAt) {
        var dateBadge = document.createElement('span');
        dateBadge.className = 'badge';
        var d = (item.createdAt || '').slice(0, 10);
        dateBadge.textContent = d;
        meta.appendChild(dateBadge);
      }
      if (item.prompt) {
        var promptLine = document.createElement('div');
        promptLine.style.fontSize = '12px';
        promptLine.style.opacity = '0.75';
        promptLine.style.marginTop = '4px';
        promptLine.style.lineHeight = '1.4';
        promptLine.textContent = item.prompt;
        meta.appendChild(promptLine);
      }
      card.appendChild(meta);

      // Action row — mirrors the single-job widget exactly: kind-
      // specific text buttons on the left (Animate / Edit for image,
      // provider-specific follow-ups for audio), icon-only utilities
      // on the right (Copy / Download / Recreate). No solid-fill
      // primary — calm Claude-style borderless throughout.
      var actions = document.createElement('div');
      actions.className = 'actions';

      var actionsLeft = document.createElement('div');
      actionsLeft.className = 'actions-left';
      actions.appendChild(actionsLeft);

      // Helper: build a text+icon button with the same shape as the
      // single-job widget's Animate / Edit buttons.
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

      // Kind-specific left-side text buttons. Mirrors single-job:
      //   image → Animate + Edit
      //   video → Edit
      //   audio → provider-specific (Suno: Stems/Extend/Cover/Music
      //           video; ElevenLabs: Change voice / Dub)
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
      } else if (item.kind === 'audio') {
        var model = item.model || '';
        if (model === 'suno' || model === 'suno-v5') {
          actionsLeft.appendChild(makeTextBtn('Stems', null, function() {
            pushFollowup('separate stems from this Suno track', 'suno_separate_stem');
          }));
          actionsLeft.appendChild(makeTextBtn('Extend', null, function() {
            pushFollowup('extend this Suno track', 'suno_extend');
          }));
          actionsLeft.appendChild(makeTextBtn('Cover', null, function() {
            pushFollowup('cover this Suno track', 'suno_cover');
          }));
        } else if (model.indexOf('elevenlabs-') === 0 && model !== 'elevenlabs-sfx') {
          actionsLeft.appendChild(makeTextBtn('Change voice', null, function() {
            pushFollowup('change the voice on this audio', 'voice_changer');
          }));
          actionsLeft.appendChild(makeTextBtn('Dub', null, function() {
            pushFollowup('dub this audio into another language', 'dubbing');
          }));
        }
        // Other audio kinds (minimax music, simple SFX) get no
        // left-side actions — same as single-job widget.
      }

      // Right-side icon utilities — Copy prompt / Download / Recreate.
      // Same icon set + behavior as the single-job widget.
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
        if (item.prompt && window.NodaroMCP && window.NodaroMCP.pushUserMessage) {
          window.NodaroMCP.pushUserMessage(item.prompt);
        }
      }));

      card.appendChild(actions);
      root.appendChild(card);
    }

    window.addEventListener('mcp-tool-result', function(e) {
      var sc = (e.detail && e.detail.structuredContent) || {};
      if (Array.isArray(sc.items)) data.items = sc.items;
      if (typeof sc.nextCursor !== 'undefined') data.nextCursor = sc.nextCursor;
      if (typeof sc.totalCount === 'number') data.totalCount = sc.totalCount;
      state.page = 0;
      state.view = 'grid';
      state.selectedId = null;
      render();
    });
  })();
</script>
</body></html>`
}

export interface GalleryItem {
  jobId: string
  kind: "image" | "video" | "audio"
  prompt: string
  model: string
  thumbnailUrl: string
  assetUrl: string
  createdAt: string
  favorited: boolean
  /**
   * Reference asset URLs that fed this generation (start frame, end frame,
   * source image for an edit, etc.). The widget renders the first 1-2 as
   * small overlay thumbnails on the tile so the visual lineage reads
   * at-a-glance. Empty array if the job had no inputs (text-to-image).
   */
  references?: string[]
}

export interface GalleryInitData {
  items: GalleryItem[]
  nextCursor: string | null
  totalCount: number
}

// Back-compat alias for callers that still pass per-call data.
export const buildGalleryWidget = (_d?: GalleryInitData): string =>
  buildGalleryWidgetTemplate()
