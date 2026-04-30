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
  /* Mobile/touch default: full-iframe-width image, no chrome — chat
     scroll handles tall portraits naturally and the iframe is already
     narrow so capping just feels cramped. Desktop refinements
     (centered + 60vh cap + rounded corners) live in the @media block
     below behind hover:hover + pointer:fine. */
  .preview { width: 100%; }
  .preview img, .preview video {
    display: block;
    width: 100%;
    height: 100%;
    max-width: none;
    max-height: none;
    object-fit: contain;
    border-radius: 0;
    margin: 0;
  }
  .preview audio { display: block; width: 100%; }
  /* Image kind: clicking the image asks the host to switch to fullscreen
     display mode (ui/request-display-mode). Cursor cue makes the
     affordance visible. We restrict to image because <video>/<audio>
     have native click-to-toggle-playback semantics that we shouldn't
     hijack. */
  .preview.image-ready img { cursor: zoom-in; }
  /* Fullscreen mode: the host sizes the iframe to viewport. We strip the
     16 px body padding (otherwise the image renders 32 px wider/taller than
     the viewport and produces scrollbars), constrain the image to fit the
     viewport with object-fit:contain, and hide chrome — the user is here
     to look at the asset, not the badges/buttons. They click the image to
     exit (cursor flips to zoom-out) or use the host's X overlay. */
  body.fullscreen { padding: 0; margin: 0; height: 100vh; overflow: hidden; }
  body.fullscreen .card { height: 100vh; gap: 0; }
  body.fullscreen .meta,
  body.fullscreen .status,
  body.fullscreen .progress,
  body.fullscreen .actions { display: none; }
  /* Flex container for the media. Default (mobile): top-aligned —
     phones have a fixed-position host chrome at the top so centering
     pushes the image behind it; top-aligned puts the image right
     under the chrome where the user can see it. Desktop overrides to
     vertical-center in the @media block below. max-height: 80vh leaves
     breathing room. width:auto + max-width:100% preserves intrinsic
     aspect ratio without needing object-fit. */
  body.fullscreen .preview { height: 100vh; display: flex; align-items: flex-start; justify-content: center; }
  body.fullscreen .preview img,
  body.fullscreen .preview video {
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: 80vh;
    border-radius: 0;
    margin: 0;
  }
  body.fullscreen .preview.image-ready img { cursor: zoom-out; }
  /* Two-column actions row: kind-specific text buttons on the left
     (Animate / Edit for image, etc.), Claude-style icon-only utilities
     on the right (Copy / Download / Recreate). The whole row is hidden
     until the asset is loaded — buttons that need outputUrl have nothing
     to act on before then. Default: visible after ready (mobile UX).
     Desktop-only: fade-in on hover for a calmer chat feel (see @media). */
  .actions { display: flex; justify-content: space-between; align-items: center; gap: 8px; opacity: 1; visibility: hidden; transition: opacity .15s; }
  .actions.ready { visibility: visible; }
  .actions-left, .actions-right { display: flex; align-items: center; }
  .actions-left { gap: 8px; }
  .actions-right { gap: 2px; }
  /* Desktop-only refinements (mouse + hover capability). Mobile/tablet
     skip these and get full-height media + always-visible buttons.
     pointer:fine excludes touchscreen-only devices that erroneously
     report hover:hover via simulated hover-on-tap. */
  @media (hover: hover) and (pointer: fine) {
    .preview img, .preview video {
      width: auto;
      height: auto;
      max-width: 100%;
      /* Fixed-px cap on desktop. Earlier 60vh tracked the viewport, which
         made the widget tower over short viewports and disappear in tall
         ones — vh is unreliable for chat-embedded widgets where the
         iframe height is host-controlled. */
      max-height: 500px;
      object-fit: unset;
      border-radius: 8px;
      margin: 0 auto;
    }
    body.fullscreen .preview { align-items: center; }
    .actions.ready { opacity: 0; }
    .card:hover .actions.ready { opacity: 1; }
  }
  button { padding: 6px 14px; border: 1px solid currentColor; background: transparent; color: inherit; border-radius: 6px; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; line-height: 1; font-family: inherit; }
  button:hover { background: rgba(127,127,127,0.1); }
  /* Icon-only utilities — minimal Claude-style: no border, subtle hover.
     Distinct from the bordered text buttons on the left so the visual
     hierarchy reads "primary actions | secondary utilities". */
  .icon-btn { padding: 6px; border: none; border-radius: 6px; opacity: 0.6; gap: 0; }
  .icon-btn:hover { opacity: 1; background: rgba(127,127,127,0.1); }
  .icon-btn svg { display: block; }
  .status { font-size: 13px; opacity: 0.85; }
`

const COPY_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`
const DOWNLOAD_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`
const RECREATE_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>`
const ANIMATE_ICON = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>`
const EDIT_ICON = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`

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
  <div class="actions" id="actions">
    <div class="actions-left">${
      mediaKind === "image"
        ? `<button id="btn-animate" title="Animate this image">${ANIMATE_ICON}<span>Animate</span></button>
      <button id="btn-edit" title="Edit this image">${EDIT_ICON}<span>Edit</span></button>`
        : ""
    }</div>
    <div class="actions-right">
      <button class="icon-btn" id="btn-copy" title="Copy prompt" aria-label="Copy prompt">${COPY_ICON}</button>
      <button class="icon-btn" id="btn-download" title="Download" aria-label="Download">${DOWNLOAD_ICON}</button>
      <button class="icon-btn" id="btn-recreate" title="Recreate" aria-label="Recreate">${RECREATE_ICON}</button>
    </div>
  </div>
</div>
<script>
  (function() {
    var MEDIA_KIND = ${JSON.stringify(mediaKind)};
    var state = { jobId: null, prompt: null, model: null, aspectRatio: null, resolution: null, duration: null, outputUrl: null, displayMode: 'inline' };

    function applyDisplayMode() {
      document.body.classList.toggle('fullscreen', state.displayMode === 'fullscreen');
    }
    // Sync from initial host context (received in ui/initialize handshake) and
    // any later host-driven changes (e.g. user clicks the host's X overlay,
    // which switches the iframe back to inline without us asking).
    window.addEventListener('mcp-ready', function(e) {
      var ctx = (e && e.detail) || window.__MCP_HOST_CONTEXT__ || {};
      if (ctx.displayMode) { state.displayMode = ctx.displayMode; applyDisplayMode(); }
    });
    window.addEventListener('mcp-host-context-changed', function(e) {
      var ctx = (e.detail && e.detail.hostContext) || e.detail || {};
      if (ctx.displayMode) { state.displayMode = ctx.displayMode; applyDisplayMode(); }
    });

    var metaEl = document.getElementById('meta');
    var statusEl = document.getElementById('status');
    var progEl = document.getElementById('progress');
    var barEl = document.getElementById('bar');
    var previewEl = document.getElementById('preview');
    var actionsEl = document.getElementById('actions');

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
      state.outputUrl = url;
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
      // Step 1: drop the "Done" label — image presence already signals completion.
      statusEl.style.display = 'none';
      // Image kind: clicking the image toggles fullscreen ↔ inline. The host
      // returns the actual mode it applied (some hosts may reject fullscreen
      // and stay inline) — trust that response over our requested target.
      // Skipped for video/audio: their native controls already use click for
      // play/pause/scrub, so hijacking it would break expected behavior.
      if (MEDIA_KIND === 'image') {
        previewEl.classList.add('image-ready');
        media.addEventListener('click', function () {
          if (!window.NodaroMCP || !window.NodaroMCP.requestDisplayMode) return;
          var target = state.displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
          window.NodaroMCP.requestDisplayMode(target).then(function(result) {
            var applied = (result && result.displayMode) || target;
            state.displayMode = applied;
            applyDisplayMode();
          });
        });
      }
      // Reveal the actions row only after the asset is loaded — buttons
      // that need outputUrl (Download / Animate / Edit) have nothing to
      // act on before this point.
      if (actionsEl) actionsEl.classList.add('ready');
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
      // Fall back to scanning raw output_data if normalised outputUrl is null.
      var resolvedUrl = sc.outputUrl;
      if (!resolvedUrl && sc.outputData && typeof sc.outputData === 'object') {
        var od = sc.outputData;
        resolvedUrl =
          od.imageUrl || od.videoUrl || od.audioUrl ||
          od.outputUrl || od.url ||
          (od.imageUrls && od.imageUrls[0]) ||
          (od.videoUrls && od.videoUrls[0]) ||
          (od.audioUrls && od.audioUrls[0]) ||
          (Array.isArray(od.outputs) && od.outputs[0] && (od.outputs[0].url || od.outputs[0].imageUrl || od.outputs[0].videoUrl)) ||
          null;
      }

      if (resolvedUrl) {
        showMedia(resolvedUrl);
        stopPolling();
        return;
      }
      if (sc.status === 'failed' || sc.status === 'cancelled') {
        statusEl.textContent = 'Job ' + sc.status;
        stopPolling();
        return;
      }
      if (sc.status === 'completed' && !resolvedUrl) {
        // Completed but the URL field wasn't where we expected — log to console
        // so the user can inspect via DevTools, and stop polling.
        console.warn('[nodaro-widget] completed without URL; output_data=', sc.outputData);
        statusEl.textContent = 'Done — see Nodaro library.';
        stopPolling();
      }
    });

    function wire(id, handler) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', handler);
    }

    // Right side — Claude-style icon utilities, universal across kinds.
    wire('btn-copy', function() {
      if (!state.prompt) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(state.prompt).catch(function() {});
      }
    });
    wire('btn-download', function() {
      if (!state.outputUrl) return;
      window.NodaroMCP.openLink(state.outputUrl);
    });
    wire('btn-recreate', function() {
      // [redacted-reference]-style recreate: push the prompt back into chat as a
      // fresh user turn. The host re-derives which tool to call.
      if (!state.prompt) return;
      if (window.NodaroMCP.pushUserMessage) {
        window.NodaroMCP.pushUserMessage(state.prompt);
      }
    });

    // Left side — kind-specific text buttons. Image gets Animate + Edit;
    // other kinds will gain their own buttons here (extend, captions, etc.).
    wire('btn-animate', function() {
      if (!state.outputUrl) return;
      window.NodaroMCP.suggestTool('animate_image', {
        image_url: state.outputUrl,
        prompt: state.prompt || undefined
      });
    });
    wire('btn-edit', function() {
      if (!state.outputUrl) return;
      window.NodaroMCP.suggestTool('modify_image', {
        image_url: state.outputUrl,
        prompt: state.prompt || undefined
      });
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
