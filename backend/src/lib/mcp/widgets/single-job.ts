/**
 * Single-job widget templates for image/video/audio/generic outputs.
 *
 * The widget is a STATIC template registered as an MCP UI resource at
 * `ui://nodaro/widget/job-{kind}`. The host fetches it once via
 * `resources/read`, renders it inside a sandboxed iframe, then delivers the
 * per-call data via `ui/notifications/tool-input` and
 * `ui/notifications/tool-result` events. Progress notifications arrive via
 * `notifications/progress`. The widget uses these event streams (NOT
 * embedded init data) to populate itself.
 *
 * Same DOM-construction safety rules apply: `document.createElement` +
 * `textContent` + `setAttribute` ONLY — never raw HTML assignment.
 */
import { uiProtocolShim } from "./_common.js"

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

type MediaKind = "image" | "video" | "audio" | "generic"

/**
 * Builds the static widget HTML for a given media kind. Called once per kind
 * at server startup by the resource registrar.
 */
export function buildSingleJobWidget(mediaKind: MediaKind): string {
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8" />
<style>${SHARED_CSS}</style>
${uiProtocolShim()}
</head>
<body>
<div class="card">
  <div class="meta" id="meta"></div>
  <div class="status" id="status">Initializing…</div>
  <div class="progress" id="progress"><div id="bar"></div></div>
  <div class="preview" id="preview" hidden></div>
  <div class="actions">
    <button id="btn-open">Open in Nodaro</button>
    <button id="btn-rerun">Re-run</button>
  </div>
</div>
<script>
  (function() {
    var MEDIA_KIND = ${JSON.stringify(mediaKind)};
    var state = { jobId: null, prompt: null, model: null, aspectRatio: null, resolution: null, duration: null };

    var metaEl = document.getElementById('meta');
    var statusEl = document.getElementById('status');
    var progEl = document.getElementById('progress');
    var barEl = document.getElementById('bar');
    var previewEl = document.getElementById('preview');

    function renderMeta() {
      while (metaEl.firstChild) metaEl.removeChild(metaEl.firstChild);
      var values = [state.model, state.aspectRatio, state.resolution, state.duration ? state.duration + 's' : null];
      values.forEach(function(v) {
        if (!v) return;
        var span = document.createElement('span');
        span.className = 'badge';
        span.textContent = String(v);
        metaEl.appendChild(span);
      });
    }

    function showMedia(url) {
      while (previewEl.firstChild) previewEl.removeChild(previewEl.firstChild);
      var media;
      if (MEDIA_KIND === 'video') { media = document.createElement('video'); media.controls = true; }
      else if (MEDIA_KIND === 'audio') { media = document.createElement('audio'); media.controls = true; }
      else if (MEDIA_KIND === 'image') { media = document.createElement('img'); media.setAttribute('alt', ''); }
      else {
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

    // Tool args arrive BEFORE the result — we know prompt/model up front.
    window.addEventListener('mcp-tool-input', function(e) {
      var args = (e.detail && e.detail.arguments) || {};
      state.prompt = args.prompt || state.prompt;
      state.model = args.model || state.model;
      state.aspectRatio = args.aspect_ratio || args.aspectRatio || state.aspectRatio;
      state.resolution = args.resolution || state.resolution;
      state.duration = args.duration || state.duration;
      renderMeta();
      statusEl.textContent = 'Generating…';
    });

    // Tool result arrives once the server has created the job and returned
    // the jobId via structuredContent. We then start polling get_asset until
    // the job lands — stateless HTTP transport can't deliver async progress
    // notifications, so polling via tools/call is the only path that works.
    window.addEventListener('mcp-tool-result', function(e) {
      var sc = (e.detail && e.detail.structuredContent) || {};
      if (sc.jobId) state.jobId = sc.jobId;
      if (sc.model) state.model = sc.model;
      if (sc.aspectRatio) state.aspectRatio = sc.aspectRatio;
      if (sc.resolution) state.resolution = sc.resolution;
      if (sc.duration) state.duration = sc.duration;
      if (sc.outputUrl) {
        showMedia(sc.outputUrl);
      } else if (state.jobId) {
        statusEl.textContent = 'Generating…';
        startPolling();
      }
      renderMeta();
    });

    // Bridged from progress-emitter via host-forwarded notifications/progress.
    // Currently a no-op for stateless HTTP transport but kept for forward
    // compatibility (e.g. session-based connections in future MCP clients).
    window.addEventListener('mcp-progress', function(e) {
      var p = e.detail || {};
      if (state.jobId && p.progressToken && p.progressToken !== state.jobId) return;
      var pct = (p.progress || 0);
      // Spec ambiguity: progress may be 0-1 or 0-100. Normalise.
      if (pct > 1) pct = pct;
      else pct = pct * 100;
      barEl.style.width = pct.toFixed(1) + '%';
      statusEl.textContent = 'Generating… ' + Math.round(pct) + '%' + (p.message ? ' — ' + p.message : '');
    });

    // ── Poll loop: tools/call get_asset every 2s until terminal ──
    var pollTimer = null;
    var pollAttempt = 0;
    var POLL_MS = 2000;
    var MAX_POLL_MS = 5 * 60 * 1000; // give up after 5 minutes

    function startPolling() {
      if (pollTimer) return;
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
        statusEl.textContent = 'Still working — check Nodaro library.';
        return;
      }
      if (!state.jobId) return;
      // Use a unique JSON-RPC id per poll so the protocol shim can route
      // the response back to us via its pending-request map.
      var reqId = 'poll-' + state.jobId + '-' + pollAttempt;
      window.parent.postMessage({
        jsonrpc: '2.0', id: reqId,
        method: 'tools/call',
        params: { name: 'get_asset', arguments: { job_id: state.jobId } }
      }, '*');
    }
    // The shim turns inbound non-id'd messages into custom events; for our
    // poll responses (which DO have an id) we listen directly on message.
    window.addEventListener('message', function(ev) {
      var data = ev.data;
      if (!data || data.jsonrpc !== '2.0' || !data.id) return;
      if (typeof data.id !== 'string' || data.id.indexOf('poll-') !== 0) return;
      if (data.error) { return; }
      var sc = (data.result && data.result.structuredContent) || {};
      if (typeof sc.progress === 'number') {
        var pct = sc.progress > 1 ? sc.progress : sc.progress * 100;
        barEl.style.width = pct.toFixed(1) + '%';
        statusEl.textContent = 'Generating… ' + Math.round(pct) + '%';
      }
      if (sc.outputUrl) {
        showMedia(sc.outputUrl);
        stopPolling();
        return;
      }
      if (sc.status === 'failed' || sc.status === 'cancelled') {
        statusEl.textContent = 'Job ' + sc.status;
        stopPolling();
        return;
      }
      if (sc.status === 'completed' && !sc.outputUrl) {
        // Completed but no media URL — generic kind. Just stop spinning.
        statusEl.textContent = 'Done — see Nodaro library.';
        stopPolling();
      }
    });

    // Re-run: orchestrator path is to push a chat message asking Claude to
    // call the tool again with the same args. (App-callable tool variants are
    // a future enhancement.)
    document.getElementById('btn-open').addEventListener('click', function() {
      window.NodaroMCP.openLink('https://app.nodaro.ai/library');
    });
    document.getElementById('btn-rerun').addEventListener('click', function() {
      var toolName = MEDIA_KIND === 'video' ? 'generate_video' :
                     MEDIA_KIND === 'audio' ? 'generate_music' :
                     'generate_image';
      window.NodaroMCP.suggestTool(toolName, { prompt: state.prompt || '', model: state.model || undefined });
    });
  })();
</script>
</body></html>`
}

export type SingleJobInitData = {
  jobId: string
  prompt: string
  model: string
  aspectRatio?: string
  resolution?: string
  duration?: number
  outputUrl?: string
}

// Back-compat aliases — callers that still reference the old per-call
// builders get a stub that delegates to the static template builder. The
// per-call init data is no longer baked into HTML; it flows via tool-result.
export const buildImageWidget = (_d?: SingleJobInitData): string => buildSingleJobWidget("image")
export const buildVideoWidget = (_d?: SingleJobInitData): string => buildSingleJobWidget("video")
export const buildAudioWidget = (_d?: SingleJobInitData): string => buildSingleJobWidget("audio")
export const buildGenericJobWidget = (_d?: SingleJobInitData): string =>
  buildSingleJobWidget("generic")
