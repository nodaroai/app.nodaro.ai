/**
 * Gallery widget — paginated grid + per-thumbnail Use button + fullscreen
 * detail view. The detail view is internal SPA routing within the same iframe
 * (no separate widget resource), so the host renders only one widget per
 * `browse_gallery` / `list_favorites` call.
 *
 * Same DOM-construction safety rules as `single-job.ts` — runtime JS uses
 * `document.createElement` + `textContent` + `setAttribute` ONLY.
 */
import { uiProtocolShim } from "./_common.js"
import { embedInitData } from "./builder.js"

interface GalleryItem {
  jobId: string
  kind: "image" | "video" | "audio"
  prompt: string
  model: string
  thumbnailUrl: string
  assetUrl: string
  createdAt: string
  favorited: boolean
}

interface GalleryInitData {
  items: GalleryItem[]
  nextCursor: string | null
  totalCount: number
}

const GALLERY_CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 12px; font: 13px system-ui, sans-serif; background: transparent; color: inherit; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
  .tile { position: relative; aspect-ratio: 1/1; border-radius: 8px; overflow: hidden; background: rgba(0,0,0,0.05); cursor: pointer; }
  .tile img, .tile video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .tile:hover .use { opacity: 1; }
  .use { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 4px 12px; background: #c4ff00; color: #000; border-radius: 999px; font-weight: 600; font-size: 12px; opacity: 0; transition: opacity .2s; pointer-events: auto; }
  .pagination { display: flex; justify-content: center; gap: 6px; margin-top: 12px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(127,127,127,0.3); cursor: pointer; }
  .dot.active { background: currentColor; }
  .footer { margin-top: 12px; opacity: 0.7; font-size: 12px; text-align: center; }
  .detail { padding: 16px; }
  .detail .preview { width: 100%; max-height: 70vh; }
  .detail .preview img, .detail .preview video, .detail .preview audio { width: 100%; height: auto; max-height: 70vh; object-fit: contain; }
  .detail .meta { margin-top: 12px; }
  .detail .actions { display: flex; gap: 8px; margin-top: 12px; }
  button { padding: 6px 14px; border: 1px solid currentColor; background: transparent; color: inherit; border-radius: 6px; font-size: 13px; cursor: pointer; }
`

export function buildGalleryWidget(data: GalleryInitData): string {
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8" />
<style>${GALLERY_CSS}</style>
${embedInitData(data)}
${uiProtocolShim()}
</head>
<body>
<div id="root"></div>
<script>
  (function() {
    var INIT = window.__INIT__;
    var ITEMS_PER_PAGE = 12;
    var state = { page: 0, view: 'grid', selectedId: null };
    var root = document.getElementById('root');

    function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

    function render() {
      clear(root);
      if (state.view === 'detail') renderDetail();
      else renderGrid();
    }

    function renderGrid() {
      var totalPages = Math.max(1, Math.ceil(INIT.items.length / ITEMS_PER_PAGE));
      var start = state.page * ITEMS_PER_PAGE;
      var pageItems = INIT.items.slice(start, start + ITEMS_PER_PAGE);

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
          media = document.createElement('video');
          media.muted = true;
          media.setAttribute('src', item.assetUrl);
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
          window.NodaroMCP.useAsset(item.jobId, item.kind);
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
      var more = INIT.nextCursor ? ', ' + INIT.totalCount + ' total — more available' : '';
      footer.textContent = INIT.items.length + ' shown' + more;
      root.appendChild(footer);
    }

    function renderDetail() {
      var item = INIT.items.find(function(it) { return it.jobId === state.selectedId; });
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
        line.appendChild(document.createTextNode(pair[1]));
        meta.appendChild(line);
      });
      detail.appendChild(meta);

      var actions = document.createElement('div');
      actions.className = 'actions';
      var useBtn = document.createElement('button');
      useBtn.textContent = 'Use as reference';
      useBtn.addEventListener('click', function() { window.NodaroMCP.useAsset(item.jobId, item.kind); });
      actions.appendChild(useBtn);
      var openBtn = document.createElement('button');
      openBtn.textContent = 'Open in Nodaro';
      openBtn.addEventListener('click', function() { window.NodaroMCP.openLink('https://app.nodaro.ai/library'); });
      actions.appendChild(openBtn);
      detail.appendChild(actions);
      root.appendChild(detail);
    }

    render();
  })();
</script>
</body></html>`
}

export type { GalleryItem, GalleryInitData }
