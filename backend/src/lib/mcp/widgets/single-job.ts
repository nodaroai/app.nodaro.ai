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
  :root {
    color-scheme: light dark;
    --nodaro-brand: #ff0073;
    --nodaro-brand-hover: #e60068;
    --caption-fg: rgba(127,127,127,0.85);
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; font: 14px system-ui, sans-serif; background: transparent; color: inherit; }
  /* No card chrome — Claude.ai's host already provides the
     "N · Nodaro · generate_image · </>" header bar plus the metadata
     pills (model + aspect ratio). Adding our own card frame and
     duplicate brand/caption rows just made the widget heavier and
     competed with the host UI. The widget is now the image + actions
     only; the host does the framing. */
  .card {
    display: flex; flex-direction: column; gap: 8px;
    padding: 0;
    background: transparent;
    border: 0;
  }
  .meta { font-size: 12px; opacity: 0.7; display: flex; gap: 8px; flex-wrap: wrap; }
  .meta .badge { background: rgba(127,127,127,0.15); padding: 2px 8px; border-radius: 4px; }
  .preview {
    width: 100%; border-radius: 8px; overflow: hidden;
    background: rgba(127,127,127,0.08); position: relative;
    aspect-ratio: 16 / 9;
  }
  .preview.audio { aspect-ratio: auto; height: 56px; }
  .preview img, .preview video, .preview audio { display: block; width: 100%; height: auto; position: relative; z-index: 1; }
  /* Shimmer placeholder. Brand-pink sheen sweeps across the empty preview
     while the worker generates the asset. */
  .preview.loading::before {
    content: '';
    position: absolute; inset: 0;
    background:
      linear-gradient(110deg,
        transparent 30%,
        rgba(255, 0, 115, 0.20) 50%,
        transparent 70%);
    background-size: 220% 100%;
    background-repeat: no-repeat;
    animation: shimmer 1.6s linear infinite;
    pointer-events: none;
  }
  @keyframes shimmer {
    0%   { background-position: 220% 0; }
    100% { background-position: -120% 0; }
  }
  /* Whole-card breathing + subtle brand glow while the job is in flight. */
  .card.loading {
    animation: breathe 2.4s ease-in-out infinite, glow 2.4s ease-in-out infinite;
  }
  .card.done, .card.loading.done { animation: none; }
  @keyframes breathe {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.82; }
  }
  @keyframes glow {
    0%, 100% { filter: drop-shadow(0 0 0 transparent); }
    50%      { filter: drop-shadow(0 0 10px rgba(255, 0, 115, 0.32)); }
  }
  /* Always-on micro-action: small download chip overlaid bottom-right of
     the image. Visible whenever the asset is ready (hidden during shimmer).
     Works on touch devices without a hover gesture. */
  .download-pill {
    position: absolute; right: 8px; bottom: 8px;
    width: 32px; height: 32px;
    border-radius: 50%; border: 0;
    background: rgba(0,0,0,0.55); color: white;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; z-index: 3;
    opacity: 0; transition: opacity .2s, background .15s;
    font-size: 16px; line-height: 1;
  }
  .preview:not(.loading) .download-pill { opacity: 0.9; }
  .download-pill:hover { background: rgba(0,0,0,0.78); opacity: 1; }
  .preview.audio .download-pill { right: 8px; bottom: 12px; }
  /* Hover overlay on the image — desktop-style enhancement when the host
     supports hover. Sits over the bottom of the media with a gradient
     scrim, fades in/out. */
  .hover-actions {
    position: absolute; left: 0; right: 48px; bottom: 0;
    display: flex; justify-content: center; gap: 8px;
    padding: 12px 12px 14px;
    background: linear-gradient(to top, rgba(0,0,0,0.55), transparent);
    opacity: 0; pointer-events: none;
    transition: opacity .15s;
    z-index: 2;
  }
  @media (hover: hover) {
    .preview:not(.loading):hover .hover-actions { opacity: 1; pointer-events: auto; }
  }
  /* Touch / coarse-pointer fallback: drop the overlay out of absolute
     positioning, sit below the image as a regular flex row that's always
     visible. No scrim, neutral pill style so it doesn't compete with the
     brand-color Recreate CTA. */
  @media (hover: none) {
    .hover-actions {
      position: static; right: auto;
      background: transparent; padding: 4px 0;
      opacity: 1; pointer-events: auto;
      transition: none; flex-wrap: wrap;
    }
    .ha-btn {
      background: rgba(127,127,127,0.14); color: inherit;
    }
    .ha-btn:hover { background: rgba(127,127,127,0.22); border-color: transparent; }
    /* Hide the small download chip on touch — Download is in the action
       row already, no need for a duplicate affordance. */
    .download-pill { display: none; }
  }
  .preview.audio .hover-actions {
    background: transparent;
    padding: 4px; right: 48px;
    bottom: 50%; transform: translateY(50%);
  }
  @media (hover: none) {
    .preview.audio .hover-actions {
      position: static; transform: none;
      bottom: auto; right: auto;
    }
  }
  .ha-btn {
    background: rgba(255,255,255,0.95);
    color: var(--nodaro-brand);
    border: 1px solid transparent;
    padding: 6px 12px;
    border-radius: 999px;
    font-size: 13px; font-weight: 600;
    cursor: pointer; white-space: nowrap;
    transition: background .15s, border-color .15s, transform .15s;
  }
  .ha-btn:hover { background: white; border-color: var(--nodaro-brand); transform: translateY(-1px); }
  /* Always-visible action row below the preview. */
  .actions { display: flex; gap: 8px; align-items: center; }
  .recreate-btn {
    background: var(--nodaro-brand);
    color: white;
    border: 0;
    padding: 7px 16px;
    border-radius: 999px;
    font-size: 13px; font-weight: 600;
    cursor: pointer;
    transition: background .15s, transform .15s;
  }
  .recreate-btn:hover { background: var(--nodaro-brand-hover); transform: translateY(-1px); }
  .recreate-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
  /* Status only shown while loading. Image presence = done; no need for a
     "Done" label cluttering the post-completion UI. */
  .status { font-size: 12px; color: var(--caption-fg); }
  .card.done .status { display: none; }
`

type MediaKind = "image" | "video" | "audio" | "generic"

/**
 * Hover-overlay buttons per media kind. Image gets the full set
 * (Animate / Edit / Download); video drops Animate (already a video);
 * audio just gets Download. Each action's behaviour is wired in the
 * client JS by `data-action` attribute.
 */
function hoverButtonsHtml(kind: MediaKind): string {
  const animate = `<button class="ha-btn" data-action="animate" type="button">🎬 Animate</button>`
  const edit = `<button class="ha-btn" data-action="edit" type="button">🪄 Edit</button>`
  const download = `<button class="ha-btn" data-action="download" type="button">⬇ Download</button>`
  if (kind === "image") return `${animate}${edit}${download}`
  if (kind === "video") return `${edit}${download}`
  return download
}

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
<div class="card loading" id="card">
  <div class="meta" id="meta"></div>
  <div class="status" id="status">Initializing…</div>
  <div class="preview loading${mediaKind === "audio" ? " audio" : ""}" id="preview">
    <div class="hover-actions" id="hover-actions">${hoverButtonsHtml(mediaKind)}</div>
    <button class="download-pill" id="dl-pill" type="button" title="Download" aria-label="Download">⬇</button>
  </div>
  <div class="actions">
    <button class="recreate-btn" id="btn-recreate" type="button" disabled>🔄 Recreate</button>
  </div>
</div>
<script>
  (function() {
    var MEDIA_KIND = ${JSON.stringify(mediaKind)};
    var state = { jobId: null, prompt: null, model: null, aspectRatio: null, resolution: null, duration: null, outputUrl: null };

    var cardEl = document.getElementById('card');
    var metaEl = document.getElementById('meta');
    var statusEl = document.getElementById('status');
    var previewEl = document.getElementById('preview');
    var hoverActionsEl = document.getElementById('hover-actions');
    var dlPillEl = document.getElementById('dl-pill');
    var recreateBtnEl = document.getElementById('btn-recreate');

    function applyAspectRatio() {
      if (MEDIA_KIND === 'audio') return;
      if (!state.aspectRatio) return;
      // Accepts "16:9" or "16/9". Normalise both to CSS "16 / 9".
      var parts = String(state.aspectRatio).split(/[:\\/]/);
      if (parts.length !== 2) return;
      var w = parseFloat(parts[0]);
      var h = parseFloat(parts[1]);
      if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return;
      previewEl.style.aspectRatio = w + ' / ' + h;
    }

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
      // Clear previous children but preserve the hover-actions overlay
      // (it's the action bar that fades in on hover).
      var children = Array.prototype.slice.call(previewEl.children);
      children.forEach(function (n) { if (n !== hoverActionsEl) previewEl.removeChild(n); });
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
      // Insert the media BEFORE the hover-actions so the overlay stays on top.
      previewEl.insertBefore(media, hoverActionsEl);
      state.outputUrl = url;
      // Stop the shimmer + breathing once we have real content.
      previewEl.classList.remove('loading');
      cardEl.classList.remove('loading');
      cardEl.classList.add('done');
      // Image kind: the iframe shouldn't hold the placeholder aspect-ratio
      // once the real image is in — it'll naturally size to the image's
      // intrinsic ratio.
      if (MEDIA_KIND === 'image') previewEl.style.aspectRatio = 'auto';
      // Enable the Recreate CTA now that we have something to recreate.
      recreateBtnEl.disabled = false;
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
      applyAspectRatio();
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
      renderMeta();
      applyAspectRatio();
      if (sc.outputUrl) {
        // Server short-circuited (cache hit / fast worker) — show the image
        // immediately, no need to start the poll loop.
        showMedia(sc.outputUrl);
      } else if (state.jobId) {
        statusEl.textContent = 'Generating…';
        startPolling();
      }
    });

    // Bridged from progress-emitter via host-forwarded notifications/progress.
    // No-op for the visual layer (no progress bar) but we still update the
    // status text so the user has a sense of activity if the host happens to
    // forward progress.
    window.addEventListener('mcp-progress', function(e) {
      var p = e.detail || {};
      if (state.jobId && p.progressToken && p.progressToken !== state.jobId) return;
      if (p.message) statusEl.textContent = 'Generating… ' + p.message;
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

    // ── Action buttons ──
    // Hover row (animate / edit / download) and the always-visible Recreate
    // button below all push natural-language messages into chat (or open a
    // download URL) — [redacted-reference]-style. The LLM picks up the message and
    // calls the appropriate tool with the URL we already know.
    function buildAnimateMessage(url) {
      return 'Animate this reference image into a short video📹  Model: Auto🌠  Reference image: ' + url + '~Prompt:';
    }
    function buildEditMessage(url, model) {
      var m = model || 'Auto';
      return 'Edit this reference image🪄  Model: ' + m + '🌠  Reference image: ' + url + '~Prompt:';
    }
    function buildRecreateMessage() {
      var lines = ['Regenerate with same params:'];
      if (state.prompt) lines.push('prompt: ' + state.prompt);
      lines.push('type: ' + MEDIA_KIND);
      if (state.model) lines.push('model: ' + state.model);
      if (state.aspectRatio && MEDIA_KIND !== 'audio') lines.push('aspect_ratio: ' + state.aspectRatio);
      if (state.resolution) lines.push('resolution: ' + state.resolution);
      if (state.duration) lines.push('duration: ' + state.duration);
      return lines.join('\\n');
    }
    function downloadUrl(url) {
      // /v1/download is a same-origin proxy that streams R2 objects with
      // Content-Disposition: attachment, so the browser saves the file
      // instead of previewing it inline.
      return 'https://app.nodaro.ai/v1/download?url=' + encodeURIComponent(url);
    }

    hoverActionsEl.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.getAttribute) return;
      var action = t.getAttribute('data-action');
      if (!action || !state.outputUrl) return;
      if (action === 'download') {
        window.NodaroMCP.openLink(downloadUrl(state.outputUrl));
        return;
      }
      if (action === 'animate') {
        window.NodaroMCP.injectChatText(buildAnimateMessage(state.outputUrl));
        return;
      }
      if (action === 'edit') {
        window.NodaroMCP.injectChatText(buildEditMessage(state.outputUrl, state.model));
        return;
      }
    });

    recreateBtnEl.addEventListener('click', function () {
      window.NodaroMCP.injectChatText(buildRecreateMessage());
    });

    // Always-on download chip on the image (hidden during loading via CSS,
    // hidden on touch devices via @media (hover: none) — Download is in the
    // visible action row there).
    dlPillEl.addEventListener('click', function () {
      if (!state.outputUrl) return;
      window.NodaroMCP.openLink(downloadUrl(state.outputUrl));
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
