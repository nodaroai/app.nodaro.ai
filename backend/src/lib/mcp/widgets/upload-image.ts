/**
 * Image upload widget — file picker rendered inside Claude.ai's iframe so
 * the user can supply a photo with a single tap, no leave-tab dance.
 *
 * Wire-up:
 *   1. Tool `upload_image_widget` mints a one-shot signed token + the
 *      deterministic public URL, returns them via structuredContent.
 *   2. This widget reads `tool-result`, draws a drop-zone + file input,
 *      and uploads the picked file via multipart POST to
 *      `<PUBLIC_URL>/v1/upload-page/:token` (existing handoff endpoint —
 *      no multipart parser needed in this file, no token shape change).
 *   3. On success it calls `NodaroMCP.pushUserMessage(<announcement>)`
 *      so the LLM picks up the URL on the next turn without the user
 *      typing anything.
 *
 * UX choices:
 *   - Native `<input type="file" accept="image/*" capture="environment">`
 *     — opens the gallery on desktop and the camera on phones (great for
 *     "snap your face for a headshot" flows).
 *   - Drag-drop zone for desktop, with hover styling.
 *   - Inline progress bar + thumbnail of the uploaded image once R2
 *     confirms (mirrors gallery tiles so it looks like part of the chat).
 *   - Errors render in-place; the user can pick again without re-running
 *     the tool.
 *
 * DOM-construction safety: matches the rest of the widgets — no innerHTML
 * in the script body. SVG icons live in static body templates.
 */
import { uiProtocolShim } from "./_common.js"

const UPLOAD_CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 12px; font: 14px system-ui, sans-serif; background: transparent; color: inherit; }
  .card { display: flex; flex-direction: column; gap: 12px; }
  .drop {
    position: relative;
    border: 2px dashed rgba(127,127,127,0.4);
    border-radius: 12px;
    padding: 28px 16px;
    text-align: center;
    cursor: pointer;
    transition: border-color .15s, background .15s;
  }
  .drop:hover, .drop.over {
    border-color: #ff0073;
    background: rgba(255, 0, 115, 0.04);
  }
  .drop input[type="file"] {
    position: absolute; inset: 0;
    opacity: 0; cursor: pointer;
  }
  .drop .icon { width: 28px; height: 28px; opacity: 0.6; margin-bottom: 6px; }
  .drop .title { font-size: 13px; font-weight: 500; }
  .drop .hint { font-size: 11px; opacity: 0.65; margin-top: 4px; }
  .preview {
    position: relative;
    border-radius: 10px;
    overflow: hidden;
    background: rgba(0,0,0,0.05);
  }
  .preview img { display: block; width: 100%; height: auto; max-height: 320px; object-fit: contain; }
  .progress { height: 4px; background: rgba(127,127,127,0.2); border-radius: 2px; overflow: hidden; }
  .progress > div { height: 100%; background: #ff0073; width: 0%; transition: width .2s; }
  .status { font-size: 12px; opacity: 0.85; }
  .status.error { color: #ff3b30; opacity: 1; }
  .replace {
    margin-top: 4px;
    align-self: flex-start;
    padding: 4px 10px;
    border: 1px solid rgba(127,127,127,0.3);
    background: transparent;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
  }
  .replace:hover { background: rgba(127,127,127,0.08); }
`

export function buildUploadImageWidget(): string {
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8" />
<style>${UPLOAD_CSS}</style>
${uiProtocolShim()}
</head>
<body>
<div class="card" id="card">
  <div class="drop" id="drop">
    <input id="file" type="file" accept="image/*" capture="environment" aria-label="Choose image" />
    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
    <div class="title">Drop an image or tap to choose</div>
    <div class="hint" id="hint">PNG, JPG, WEBP, HEIC — up to 50 MB</div>
  </div>
  <div class="status" id="status"></div>
  <div class="progress" id="progress" hidden><div id="bar"></div></div>
</div>
<script>
  (function() {
    var state = { uploadUrl: null, publicUrl: null, prompt: null, uploaded: false };

    var card = document.getElementById('card');
    var dropEl = document.getElementById('drop');
    var fileEl = document.getElementById('file');
    var statusEl = document.getElementById('status');
    var progressEl = document.getElementById('progress');
    var barEl = document.getElementById('bar');

    function setStatus(text, isError) {
      statusEl.textContent = text || '';
      statusEl.className = 'status' + (isError ? ' error' : '');
    }

    function setProgress(pct) {
      if (pct === null || pct === undefined) {
        progressEl.hidden = true;
        return;
      }
      progressEl.hidden = false;
      barEl.style.width = Math.max(0, Math.min(100, pct)).toFixed(1) + '%';
    }

    /** Replace the drop zone with the uploaded image preview + a "replace" button. */
    function renderUploaded(localObjectUrl) {
      while (card.firstChild) card.removeChild(card.firstChild);

      var preview = document.createElement('div');
      preview.className = 'preview';
      var img = document.createElement('img');
      img.setAttribute('src', localObjectUrl);
      img.setAttribute('alt', '');
      preview.appendChild(img);
      card.appendChild(preview);

      var status = document.createElement('div');
      status.className = 'status';
      status.textContent = 'Uploaded — ready for the next step.';
      card.appendChild(status);

      var replace = document.createElement('button');
      replace.type = 'button';
      replace.className = 'replace';
      replace.textContent = 'Replace';
      replace.addEventListener('click', function() { window.location.reload(); });
      card.appendChild(replace);
    }

    function announceToHost() {
      if (!state.publicUrl || !window.NodaroMCP || !window.NodaroMCP.pushUserMessage) return;
      // Plain announcement — let the LLM decide what to do with the URL
      // next (run_app, modify_image, etc.). The trailer keeps it on-task
      // even if the user has been chatting in between.
      var purpose = state.prompt ? ' (' + state.prompt + ')' : '';
      window.NodaroMCP.pushUserMessage(
        "The user's image is uploaded and ready at " + state.publicUrl +
        purpose + '. Use this URL as the image input for the next step.'
      );
    }

    async function upload(file) {
      if (!state.uploadUrl) {
        setStatus('Not ready — try again in a moment.', true);
        return;
      }
      if (!file.type || file.type.indexOf('image/') !== 0) {
        setStatus('That doesn\\'t look like an image — pick a PNG/JPG/WEBP/HEIC.', true);
        return;
      }
      setStatus('Uploading…', false);
      setProgress(0);

      // XHR (not fetch) so we get progress events. Multipart form to
      // match the existing /v1/upload-page handoff endpoint.
      var formData = new FormData();
      formData.append('file', file);
      var xhr = new XMLHttpRequest();
      xhr.open('POST', state.uploadUrl);
      xhr.upload.onprogress = function(e) {
        if (e.lengthComputable) setProgress((e.loaded / e.total) * 100);
      };
      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
          state.uploaded = true;
          setProgress(100);
          renderUploaded(URL.createObjectURL(file));
          announceToHost();
        } else {
          var msg = 'Upload failed';
          try {
            var body = JSON.parse(xhr.responseText);
            if (body && body.error && body.error.message) msg += ': ' + body.error.message;
          } catch (_) {}
          setStatus(msg + ' (HTTP ' + xhr.status + ')', true);
          setProgress(null);
        }
      };
      xhr.onerror = function() {
        setStatus('Network error — check your connection and try again.', true);
        setProgress(null);
      };
      xhr.send(formData);
    }

    fileEl.addEventListener('change', function(e) {
      var f = e.target.files && e.target.files[0];
      if (f) upload(f);
    });

    // Drag-drop affordance — most useful on desktop. The native click
    // path through the file input handles taps on mobile.
    dropEl.addEventListener('dragover', function(e) {
      e.preventDefault();
      dropEl.classList.add('over');
    });
    dropEl.addEventListener('dragleave', function() { dropEl.classList.remove('over'); });
    dropEl.addEventListener('drop', function(e) {
      e.preventDefault();
      dropEl.classList.remove('over');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) upload(f);
    });

    // structuredContent arrives via mcp-tool-result. The token is a
    // one-shot HMAC; we don't need any auth on the iframe side.
    window.addEventListener('mcp-tool-result', function(e) {
      var sc = (e.detail && e.detail.structuredContent) || {};
      if (sc.upload_url) state.uploadUrl = sc.upload_url;
      if (sc.public_url) state.publicUrl = sc.public_url;
      if (sc.prompt) state.prompt = sc.prompt;
    });
  })();
</script>
</body></html>`
}
