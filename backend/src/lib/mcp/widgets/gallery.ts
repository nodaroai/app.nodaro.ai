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
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
  .tile { position: relative; aspect-ratio: 1/1; border-radius: 8px; overflow: hidden; background: rgba(0,0,0,0.05); cursor: pointer; }
  .tile img, .tile video { width: 100%; height: 100%; object-fit: cover; display: block; }
  /* Tile Use pill — hover-only affordance. Hidden on touch devices
     (no hover) because the invisible-but-clickable pill was grabbing
     taps meant for opening the tile in detail view. Mobile users get
     the prominent "Use as reference" button inside the detail view
     instead. Brand pink (#ff0073) matches the detail-view primary
     button + favorite star. */
  .use { display: none; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 4px 12px; background: #ff0073; color: #fff; border-radius: 999px; font-weight: 600; font-size: 12px; opacity: 0; transition: opacity .2s, transform .2s; pointer-events: auto; }
  @media (hover: hover) and (pointer: fine) {
    .use { display: block; }
    .tile:hover .use { opacity: 1; }
    .use:hover { transform: translate(-50%, -50%) scale(1.05); }
  }
  .pagination { display: flex; justify-content: center; gap: 6px; margin-top: 12px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(127,127,127,0.3); cursor: pointer; }
  .dot.active { background: currentColor; }
  .footer { margin-top: 12px; opacity: 0.7; font-size: 12px; text-align: center; }
  .empty { text-align: center; padding: 32px 0; opacity: 0.7; }
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
        return;
      }
      if (state.view === 'detail') renderDetail();
      else renderGrid();
    }

    function renderGrid() {
      var totalPages = Math.max(1, Math.ceil(data.items.length / ITEMS_PER_PAGE));
      var start = state.page * ITEMS_PER_PAGE;
      var pageItems = data.items.slice(start, start + ITEMS_PER_PAGE);

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

        var media;
        if (item.kind === 'video') {
          // If the backend has a thumbnail URL, render it as an <img>
          // (cleanest result — no play-button overlay, no decoder cost).
          // Otherwise fall back to a <video> element with preload metadata
          // and a forced seek to the first frame so the tile shows the
          // actual frame instead of the browser's blank/play-button
          // poster. playsinline keeps iOS Safari from auto-launching the
          // native fullscreen player when the iframe scrolls into view.
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
        } else {
          media = document.createElement('img');
          media.setAttribute('src', item.thumbnailUrl || item.assetUrl);
          media.setAttribute('alt', '');
          media.setAttribute('loading', 'lazy');
        }
        tile.appendChild(media);

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
        tile.appendChild(useBtn);

        grid.appendChild(tile);
      });
      root.appendChild(grid);

      var pagination = document.createElement('div');
      pagination.className = 'pagination';
      for (var i = 0; i < totalPages; i++) {
        var dot = document.createElement('div');
        dot.className = 'dot' + (i === state.page ? ' active' : '');
        dot.dataset.page = String(i);
        ;(function(idx) { dot.addEventListener('click', function() { state.page = idx; render(); }); })(i);
        pagination.appendChild(dot);
      }
      root.appendChild(pagination);

      var footer = document.createElement('div');
      footer.className = 'footer';
      var more = data.nextCursor ? ', ' + data.totalCount + ' total — more available' : '';
      footer.textContent = data.items.length + ' shown' + more;
      root.appendChild(footer);
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
      if (item.kind === 'video') { media = document.createElement('video'); media.controls = true; }
      else if (item.kind === 'audio') { media = document.createElement('audio'); media.controls = true; }
      else { media = document.createElement('img'); media.setAttribute('alt', ''); }
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
