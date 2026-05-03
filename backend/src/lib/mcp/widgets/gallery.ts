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
  /* Denser grid — auto-fill at 100px so 4 columns fit comfortably on
     phone (was 120px = 3 cols). [redacted-reference]'s gallery is 4-up. */
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 8px; }
  .tile { position: relative; aspect-ratio: 1/1; border-radius: 8px; overflow: hidden; background: rgba(0,0,0,0.05); cursor: pointer; }
  .tile img, .tile video { width: 100%; height: 100%; object-fit: cover; display: block; }
  /* Hover overlay — TWO affordances side-by-side: brand-pink Use pill
     + dim Download icon. Mirrors [redacted-reference]'s hover state. Hidden on
     touch devices (no hover) because the invisible-but-clickable
     overlay was grabbing taps meant to open the tile. */
  .hover-overlay {
    display: none;
    position: absolute;
    inset: 0;
    align-items: center;
    justify-content: center;
    gap: 6px;
    opacity: 0;
    transition: opacity .15s;
    background: linear-gradient(180deg, rgba(0,0,0,0) 50%, rgba(0,0,0,0.35) 100%);
    pointer-events: none;
  }
  .hover-overlay > * { pointer-events: auto; }
  .use { padding: 4px 14px; background: #ff0073; color: #fff; border-radius: 999px; font-weight: 600; font-size: 12px; transition: transform .15s; cursor: pointer; line-height: 1.4; }
  .use:hover { transform: scale(1.05); }
  .tile-download {
    display: flex; align-items: center; justify-content: center;
    width: 28px; height: 28px;
    background: rgba(0,0,0,0.55); color: #fff;
    border-radius: 999px; cursor: pointer; transition: background .15s;
  }
  .tile-download:hover { background: rgba(0,0,0,0.75); }
  .tile-download svg { display: block; width: 14px; height: 14px; }
  @media (hover: hover) and (pointer: fine) {
    .hover-overlay { display: flex; }
    .tile:hover .hover-overlay { opacity: 1; }
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
    width: 24px; height: 24px;
    border: 0; background: transparent; color: inherit;
    border-radius: 50%; cursor: pointer; opacity: 0.6;
    transition: opacity .15s, background .15s;
  }
  .pag-btn:hover:not(:disabled) { opacity: 1; background: rgba(127,127,127,0.12); }
  .pag-btn:disabled { opacity: 0.25; cursor: default; }
  .pag-btn svg { display: block; width: 12px; height: 12px; }
  .footer { opacity: 0.6; font-size: 11px; text-align: center; }
  .empty { text-align: center; padding: 32px 0; opacity: 0.7; }
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
  .detail { padding: 16px; }
  .detail .preview { width: 100%; max-height: 70vh; }
  .detail .preview img, .detail .preview video, .detail .preview audio { width: 100%; height: auto; max-height: 70vh; object-fit: contain; }
  .detail .meta { margin-top: 12px; }
  .detail .actions { display: flex; gap: 8px; margin-top: 12px; align-items: center; }
  /* Borderless action buttons — same calm Claude-style affordance the
     single-job widget uses. Subtle dim → bright on hover. */
  button { padding: 6px 12px; border: none; background: transparent; color: inherit; border-radius: 6px; font-size: 13px; cursor: pointer; opacity: 0.7; transition: opacity .15s, background .15s, color .15s; font-family: inherit; line-height: 1; }
  button:hover { background: rgba(127,127,127,0.1); opacity: 1; }
  /* Use-as-reference is the primary action — brand pink, slightly stronger. */
  button.primary { color: #ff0073; opacity: 0.9; font-weight: 500; }
  button.primary:hover { background: rgba(255, 0, 115, 0.1); opacity: 1; }
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
<script>
  (function() {
    var ITEMS_PER_PAGE = 12;
    var data = { items: [], nextCursor: null, totalCount: 0 };
    var state = { page: 0, view: 'grid', selectedId: null };
    var root = document.getElementById('root');

    function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

    function render() {
      clear(root);
      if (!data.items.length) {
        var empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No items yet.';
        root.appendChild(empty);
      } else if (state.view === 'detail') {
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
          state.view = 'detail';
          state.selectedId = item.jobId;
          render();
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
        next.title = 'Next page';
        next.setAttribute('aria-label', 'Next page');
        next.disabled = state.page === totalPages - 1;
        var nextIcon = document.getElementById('tpl-chev-right');
        if (nextIcon && nextIcon.content) next.appendChild(nextIcon.content.cloneNode(true));
        next.addEventListener('click', function() {
          if (state.page < totalPages - 1) { state.page++; render(); }
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
      var item = data.items.find(function(it) { return it.jobId === state.selectedId; });
      if (!item) { state.view = 'grid'; render(); return; }

      var detail = document.createElement('div');
      detail.className = 'detail';

      var backBtn = document.createElement('button');
      backBtn.textContent = '← Back to grid';
      backBtn.addEventListener('click', function() { state.view = 'grid'; state.selectedId = null; render(); });
      detail.appendChild(backBtn);

      var preview = document.createElement('div');
      preview.className = 'preview';
      preview.style.marginTop = '12px';
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
      detail.appendChild(preview);

      var meta = document.createElement('div');
      meta.className = 'meta';
      [
        ['Prompt: ', item.prompt],
        ['Model: ', item.model],
        ['Created: ', item.createdAt],
      ].forEach(function(pair) {
        var line = document.createElement('div');
        var label = document.createElement('strong');
        label.textContent = pair[0];
        line.appendChild(label);
        line.appendChild(document.createTextNode(pair[1] || ''));
        meta.appendChild(line);
      });
      detail.appendChild(meta);

      var actions = document.createElement('div');
      actions.className = 'actions';
      var useBtn = document.createElement('button');
      useBtn.className = 'primary';
      useBtn.textContent = 'Use as reference';
      useBtn.addEventListener('click', function() {
        // Same self-driving Q&A loop the single-job Edit/Animate buttons
        // use. The loop covers everything — first the action (modify /
        // animate / variation / …), then whatever parameters the chosen
        // verb needs. "as needed" terminates when Claude has enough.
        if (window.NodaroMCP.pushUserMessage) {
          window.NodaroMCP.pushUserMessage(
            'Use the ' + item.kind + ' with id ' + item.jobId +
            ' as a reference. The user clicked the Use button.' +
            // Source uses double-backslash-n; the TS template literal
            // collapses it to single-backslash-n in the rendered JS, so
            // the inner string carries a real escape sequence (a raw
            // newline would break the single-quoted JS string).
            '\\n[loop ask me using q/a as needed]'
          );
        }
      });
      actions.appendChild(useBtn);
      var openBtn = document.createElement('button');
      openBtn.textContent = 'Open in Nodaro';
      openBtn.addEventListener('click', function() { window.NodaroMCP.openLink('https://app.nodaro.ai/gallery'); });
      actions.appendChild(openBtn);
      detail.appendChild(actions);
      root.appendChild(detail);
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
}

export interface GalleryInitData {
  items: GalleryItem[]
  nextCursor: string | null
  totalCount: number
}

// Back-compat alias for callers that still pass per-call data.
export const buildGalleryWidget = (_d?: GalleryInitData): string =>
  buildGalleryWidgetTemplate()
