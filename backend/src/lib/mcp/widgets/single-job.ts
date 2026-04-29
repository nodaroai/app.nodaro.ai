/**
 * Single-job widget templates for image/video/audio/generic outputs.
 *
 * Each widget renders a card showing model + parameter badges, a progress
 * bar (driven by `notifications/progress` events), the media preview once
 * available, and two action buttons (Open in Nodaro, Re-run). The runtime
 * JS uses `document.createElement` + `textContent` + `setAttribute` ONLY —
 * never raw HTML assignment (snapshot tests in
 * `__tests__/single-job.test.ts` guard this).
 *
 * Init data flows through `embedInitData` which escapes `</script>` to
 * prevent JSON breakout from a maliciously crafted prompt.
 */
import { uiProtocolShim } from "./_common.js"
import { embedInitData } from "./builder.js"

interface SingleJobInitData {
  jobId: string
  prompt: string
  model: string
  aspectRatio?: string
  resolution?: string
  duration?: number
  outputUrl?: string
}

const SHARED_CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; font: 14px system-ui, sans-serif; background: transparent; color: inherit; }
  .card { display: flex; flex-direction: column; gap: 12px; }
  .progress { height: 4px; background: rgba(127,127,127,0.2); border-radius: 2px; overflow: hidden; }
  .progress > div { height: 100%; background: linear-gradient(90deg, #5b9dff, #8e6bff); width: 0%; transition: width .3s; }
  .meta { font-size: 12px; opacity: 0.7; display: flex; gap: 8px; flex-wrap: wrap; }
  .meta .badge { background: rgba(127,127,127,0.15); padding: 2px 8px; border-radius: 4px; }
  .preview { width: 100%; border-radius: 8px; overflow: hidden; background: rgba(0,0,0,0.05); }
  .preview img, .preview video, .preview audio { display: block; width: 100%; height: auto; }
  .actions { display: flex; gap: 8px; }
  button { padding: 6px 14px; border: 1px solid currentColor; background: transparent; color: inherit; border-radius: 6px; font-size: 13px; cursor: pointer; }
  button:hover { background: rgba(127,127,127,0.1); }
  .status { font-size: 13px; opacity: 0.85; }
`

// Helper that emits the shared scaffold + JS for media-type-specific preview.
// Each builder injects its media-element creation logic via a string parameter.
function buildSingleJobWidget(
  data: SingleJobInitData,
  mediaKind: "image" | "video" | "audio" | "generic",
): string {
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8" />
<style>${SHARED_CSS}</style>
${embedInitData({ ...data, mediaKind })}
${uiProtocolShim()}
</head>
<body>
<div class="card">
  <div class="meta" id="meta"></div>
  <div class="status" id="status"></div>
  <div class="progress" id="progress"><div id="bar"></div></div>
  <div class="preview" id="preview" hidden></div>
  <div class="actions">
    <button id="btn-open">Open in Nodaro</button>
    <button id="btn-rerun">Re-run</button>
  </div>
</div>
<script>
  (function() {
    var INIT = window.__INIT__;
    var metaEl = document.getElementById('meta');
    var statusEl = document.getElementById('status');
    var progEl = document.getElementById('progress');
    var barEl = document.getElementById('bar');
    var previewEl = document.getElementById('preview');

    [INIT.model, INIT.aspectRatio, INIT.resolution, INIT.duration ? INIT.duration + 's' : null].forEach(function(v) {
      if (!v) return;
      var span = document.createElement('span');
      span.className = 'badge';
      span.textContent = String(v);
      metaEl.appendChild(span);
    });

    function showMedia(url) {
      while (previewEl.firstChild) previewEl.removeChild(previewEl.firstChild);
      var media;
      if (INIT.mediaKind === 'video') { media = document.createElement('video'); media.controls = true; }
      else if (INIT.mediaKind === 'audio') { media = document.createElement('audio'); media.controls = true; }
      else if (INIT.mediaKind === 'image') { media = document.createElement('img'); media.setAttribute('alt', ''); }
      else {
        // generic — show text link
        media = document.createElement('a');
        media.setAttribute('href', url);
        media.setAttribute('target', '_blank');
        media.textContent = 'View output';
      }
      media.setAttribute('src', url);
      previewEl.appendChild(media);
      previewEl.hidden = false;
      progEl.hidden = true;
      statusEl.textContent = 'Done';
    }

    if (INIT.outputUrl) {
      showMedia(INIT.outputUrl);
    } else {
      statusEl.textContent = 'Generating…';
    }

    document.getElementById('btn-open').addEventListener('click', function() {
      window.NodaroMCP.openLink('https://app.nodaro.ai/library');
    });
    document.getElementById('btn-rerun').addEventListener('click', function() {
      var toolName = INIT.mediaKind === 'video' ? 'generate_video' : INIT.mediaKind === 'audio' ? 'generate_music' : 'generate_image';
      window.NodaroMCP.suggestTool(toolName, { prompt: INIT.prompt, model: INIT.model });
    });

    window.addEventListener('mcp-progress', function(e) {
      var p = e.detail;
      if (!p || p.progressToken !== INIT.jobId) return;
      barEl.style.width = ((p.progress || 0) * 100).toFixed(1) + '%';
      statusEl.textContent = 'Generating… ' + Math.round((p.progress || 0) * 100) + '%' + (p.message ? ' — ' + p.message : '');
    });

    window.addEventListener('mcp-ui-message', function(e) {
      var msg = e.detail;
      if (!msg.content || !msg.content[0]) return;
      var text = msg.content[0].text || '';
      var url = text.match(/^asset_url:\\s*(https?:\\/\\/[^\\s]+)/);
      if (url) showMedia(url[1]);
    });
  })();
</script>
</body></html>`
}

export function buildImageWidget(data: SingleJobInitData): string {
  return buildSingleJobWidget(data, "image")
}
export function buildVideoWidget(data: SingleJobInitData): string {
  return buildSingleJobWidget(data, "video")
}
export function buildAudioWidget(data: SingleJobInitData): string {
  return buildSingleJobWidget(data, "audio")
}
export function buildGenericJobWidget(data: SingleJobInitData): string {
  return buildSingleJobWidget(data, "generic")
}

export type { SingleJobInitData }
