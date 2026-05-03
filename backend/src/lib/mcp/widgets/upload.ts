/**
 * Upload widget — file picker rendered inside Claude.ai's iframe so the
 * user can supply media with a single tap, no leave-tab dance.
 *
 * Parameterized by media kind (image / audio / video). Each kind ships
 * its own widget HTML at registration time (see widgets/registrar.ts)
 * so the rendered template can bake in kind-specific defaults: file
 * input `accept` MIME, button labels, hint text, the auto-announce
 * message Claude sees after a successful upload.
 *
 * Multi-file support: structuredContent carries an `uploads` array of
 * `{upload_url, public_url}` pairs (one per intended file). The widget
 * uploads the picked files in parallel into the next available slot
 * and announces ALL urls together once everything succeeds. For the
 * single-file case (the default and historical shape), the tool emits
 * a one-element `uploads` array — the widget treats that uniformly.
 *
 * Wire-up:
 *   1. A `upload_<kind>_widget` tool mints N one-shot signed tokens +
 *      deterministic public URLs and returns them via structuredContent.
 *   2. This widget reads `tool-result`, draws a drop-zone + file input,
 *      and uploads each picked file via multipart POST to
 *      `<PUBLIC_URL>/v1/upload-page/:token` (existing handoff endpoint —
 *      no multipart parser needed in this file, no token shape change).
 *   3. On success it calls `NodaroMCP.pushUserMessage(<announcement>)`
 *      so the LLM picks up the URL(s) on the next turn without the
 *      user typing anything.
 *
 * UX choices:
 *   - Native `<input type="file" accept="<kind>/*">` (no `capture` attr —
 *     Android Chrome and the Claude Android app's WebView interpret
 *     `capture="environment"` as "open the camera DIRECTLY", skipping
 *     the gallery/picker entirely. Without `capture`, mobile users get
 *     the standard chooser with both camera AND gallery options).
 *   - Drag-drop zone for desktop, with hover styling.
 *   - Per-file row with progress bar while uploading; final preview grid
 *     after all files complete.
 *   - Errors render in-place; the user can pick again without re-running
 *     the tool.
 *
 * DOM-construction safety: matches the rest of the widgets — no innerHTML
 * in the script body. SVG icons live in static body templates.
 */
import { uiProtocolShim } from "./_common.js"

type UploadKind = "image" | "audio" | "video"

interface KindCopy {
  acceptMime: string
  title: string
  hint: string
  noun: string
  nounPlural: string
}

const KIND_COPY: Record<UploadKind, KindCopy> = {
  image: {
    acceptMime: "image/*",
    title: "Drop an image or tap to choose",
    hint: "PNG, JPG, WEBP, HEIC — up to 50 MB each",
    noun: "image",
    nounPlural: "images",
  },
  audio: {
    acceptMime: "audio/*",
    title: "Drop an audio file or tap to choose",
    hint: "MP3, WAV, M4A, OGG, FLAC — up to 50 MB each",
    noun: "audio file",
    nounPlural: "audio files",
  },
  video: {
    acceptMime: "video/*",
    title: "Drop a video or tap to choose",
    hint: "MP4, WEBM, MOV, MKV — up to 50 MB each",
    noun: "video",
    nounPlural: "videos",
  },
}

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
  .file-list { display: flex; flex-direction: column; gap: 8px; }
  .file-row { display: flex; gap: 10px; align-items: center; padding: 8px; border: 1px solid rgba(127,127,127,0.18); border-radius: 8px; }
  .file-row .thumb { width: 40px; height: 40px; flex-shrink: 0; border-radius: 6px; overflow: hidden; background: rgba(0,0,0,0.05); display: flex; align-items: center; justify-content: center; }
  .file-row .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .file-row .thumb .glyph { font-size: 18px; opacity: 0.6; }
  .file-row .meta { flex: 1; min-width: 0; }
  .file-row .name { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .file-row .sub { font-size: 11px; opacity: 0.65; margin-top: 2px; }
  .file-row .sub.error { color: #ff3b30; opacity: 1; }
  .file-row .bar { height: 3px; background: rgba(127,127,127,0.2); border-radius: 2px; overflow: hidden; margin-top: 4px; }
  .file-row .bar > div { height: 100%; background: #ff0073; width: 0%; transition: width .2s; }
  .file-row .check { font-size: 16px; color: #34c759; flex-shrink: 0; }
  .preview-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
  .preview-grid .cell { aspect-ratio: 1/1; border-radius: 8px; overflow: hidden; background: rgba(0,0,0,0.05); position: relative; display: flex; align-items: center; justify-content: center; }
  .preview-grid .cell img, .preview-grid .cell video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .preview-grid .cell .glyph { font-size: 24px; opacity: 0.6; }
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

export function buildUploadWidget(kind: UploadKind): string {
  const copy = KIND_COPY[kind]
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8" />
<style>${UPLOAD_CSS}</style>
${uiProtocolShim()}
</head>
<body>
<div class="card" id="card">
  <div class="drop" id="drop">
    <input id="file" type="file" accept="${copy.acceptMime}" multiple aria-label="Choose ${copy.nounPlural}" />
    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
    <div class="title">${copy.title}</div>
    <div class="hint">${copy.hint}</div>
  </div>
  <div class="file-list" id="file-list" hidden></div>
  <div class="status" id="status"></div>
</div>
<script>
  (function() {
    var KIND = ${JSON.stringify(kind)};
    var NOUN = ${JSON.stringify(copy.noun)};
    var NOUN_PLURAL = ${JSON.stringify(copy.nounPlural)};
    var ACCEPT_PREFIX = ${JSON.stringify(kind + "/")};

    // Slot = one tool-allocated upload destination. Each slot is consumed by
    // at most one picked file. If the user picks more files than slots, we
    // drop the extras with a clear error so the LLM can re-run with a higher
    // max_files next turn.
    var slots = []; // [{upload_url, public_url, taken: bool}]
    var rows = []; // parallel array of accepted picks: [{file, status, publicUrl}]
    var prompt = null;

    var card = document.getElementById('card');
    var dropEl = document.getElementById('drop');
    var fileEl = document.getElementById('file');
    var statusEl = document.getElementById('status');
    var listEl = document.getElementById('file-list');

    function setStatus(text, isError) {
      statusEl.textContent = text || '';
      statusEl.className = 'status' + (isError ? ' error' : '');
    }

    /** Append a new file row to the list and return helpers to update it. */
    function appendRow(file) {
      var row = document.createElement('div');
      row.className = 'file-row';
      var thumb = document.createElement('div');
      thumb.className = 'thumb';
      if (KIND === 'image') {
        var img = document.createElement('img');
        img.setAttribute('alt', '');
        img.setAttribute('src', URL.createObjectURL(file));
        thumb.appendChild(img);
      } else {
        var g = document.createElement('div');
        g.className = 'glyph';
        g.textContent = KIND === 'audio' ? '♫' : '▶';
        thumb.appendChild(g);
      }
      row.appendChild(thumb);
      var meta = document.createElement('div');
      meta.className = 'meta';
      var name = document.createElement('div');
      name.className = 'name';
      name.textContent = file.name;
      var sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = 'Uploading… ' + Math.round(file.size / 1024) + ' KB';
      var bar = document.createElement('div');
      bar.className = 'bar';
      var fill = document.createElement('div');
      bar.appendChild(fill);
      meta.appendChild(name);
      meta.appendChild(sub);
      meta.appendChild(bar);
      row.appendChild(meta);
      var check = document.createElement('div');
      check.className = 'check';
      check.style.visibility = 'hidden';
      check.textContent = '✔';
      row.appendChild(check);
      listEl.appendChild(row);
      listEl.hidden = false;
      return {
        setProgress: function(pct) { fill.style.width = Math.max(0, Math.min(100, pct)).toFixed(1) + '%'; },
        setStatus: function(text, isError) { sub.textContent = text; sub.className = 'sub' + (isError ? ' error' : ''); },
        markDone: function() { check.style.visibility = 'visible'; },
      };
    }

    // Track DOM nodes appended in renderFinal so the Replace button can
    // remove them without nuking the original drop zone (window.reload
    // wiped the slot data delivered via mcp-tool-result, leaving the
    // user with a non-functional widget — the "hides image and does
    // nothing" symptom).
    var finalNodes = [];

    /** Append a preview grid + Replace button beneath the existing
     *  drop zone. Hides the drop zone + status while the post-upload
     *  state is shown. Replace restores the initial state in-place
     *  (no iframe reload — slots are still valid for a re-upload). */
    function renderFinal() {
      // Hide the drop zone + the in-progress file-list + the status
      // line. We KEEP them in the DOM so Replace can show them again
      // without rebuilding from scratch.
      dropEl.style.display = 'none';
      listEl.hidden = true;
      statusEl.style.display = 'none';

      var grid = document.createElement('div');
      grid.className = 'preview-grid';
      rows.forEach(function(r) {
        var cell = document.createElement('div');
        cell.className = 'cell';
        if (KIND === 'image') {
          var img = document.createElement('img');
          img.setAttribute('alt', '');
          img.setAttribute('src', URL.createObjectURL(r.file));
          cell.appendChild(img);
        } else {
          var g = document.createElement('div');
          g.className = 'glyph';
          g.textContent = KIND === 'audio' ? '♫' : '▶';
          cell.appendChild(g);
        }
        grid.appendChild(cell);
      });
      card.appendChild(grid);
      finalNodes.push(grid);

      var doneStatus = document.createElement('div');
      doneStatus.className = 'status';
      doneStatus.textContent = 'Uploaded ' + rows.length + ' ' + (rows.length === 1 ? NOUN : NOUN_PLURAL) + ' — ready for the next step.';
      card.appendChild(doneStatus);
      finalNodes.push(doneStatus);

      var replace = document.createElement('button');
      replace.type = 'button';
      replace.className = 'replace';
      replace.textContent = 'Replace';
      replace.addEventListener('click', resetToDropZone);
      card.appendChild(replace);
      finalNodes.push(replace);
    }

    function resetToDropZone() {
      // Tear down the post-upload nodes.
      finalNodes.forEach(function(n) { if (n.parentNode) n.parentNode.removeChild(n); });
      finalNodes = [];
      // Reset local state — the slots themselves stay valid (their
      // tokens are still good, R2 will overwrite on the next upload).
      // The user gets the same public_url as before; we re-announce
      // it to chat after the new upload completes, which Claude
      // treats as a fresh "use this URL" instruction.
      rows = [];
      uploading = false;
      slots.forEach(function(s) { s.taken = false; });
      // Clear the in-progress file-list rows so a Replace doesn't
      // show stale per-file progress bars.
      while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
      // Reset the file input so picking the SAME file fires the change
      // event again (browsers skip the event if value didn't change).
      fileEl.value = '';
      // Restore visibility of the original drop zone.
      dropEl.style.display = '';
      statusEl.style.display = '';
      setStatus('');
    }

    /** Compose the announcement message Claude sees after all uploads succeed. */
    function announceToHost() {
      if (!window.NodaroMCP || !window.NodaroMCP.pushUserMessage) return;
      var urls = rows.filter(function(r) { return r.publicUrl; }).map(function(r) { return r.publicUrl; });
      if (urls.length === 0) return;
      var purpose = prompt ? ' (' + prompt + ')' : '';
      var head;
      if (urls.length === 1) {
        head = "The user's " + NOUN + " is uploaded and ready at " + urls[0] + purpose +
          '. Use this URL as the ' + KIND + ' input for the next step.';
      } else {
        head = "The user uploaded " + urls.length + ' ' + NOUN_PLURAL + purpose +
          '. URLs (in pick order):\\n  - ' + urls.join('\\n  - ') +
          '\\nUse these as the ' + KIND + ' inputs for the next step.';
      }
      // Same Q&A trailer the gallery / single-job action buttons use —
      // tells Claude to drive the next-step parameters interactively
      // ("what model? what aspect ratio?") instead of guessing.
      window.NodaroMCP.pushUserMessage(
        head + '\\n[loop ask me using q/a as needed]'
      );
    }

    function uploadOne(slot, file, ctrl) {
      return new Promise(function(resolve) {
        var formData = new FormData();
        formData.append('file', file);
        var xhr = new XMLHttpRequest();
        xhr.open('POST', slot.upload_url);
        xhr.upload.onprogress = function(e) {
          if (e.lengthComputable) ctrl.setProgress((e.loaded / e.total) * 100);
        };
        xhr.onload = function() {
          if (xhr.status >= 200 && xhr.status < 300) {
            ctrl.setProgress(100);
            ctrl.setStatus('Uploaded');
            ctrl.markDone();
            resolve({ ok: true, publicUrl: slot.public_url });
          } else {
            var msg = 'Upload failed';
            try {
              var body = JSON.parse(xhr.responseText);
              if (body && body.error && body.error.message) msg += ': ' + body.error.message;
            } catch (_) {}
            ctrl.setStatus(msg + ' (HTTP ' + xhr.status + ')', true);
            resolve({ ok: false, error: msg });
          }
        };
        xhr.onerror = function() {
          ctrl.setStatus('Network error', true);
          resolve({ ok: false, error: 'network' });
        };
        xhr.send(formData);
      });
    }

    async function handlePicked(picked) {
      if (slots.length === 0) {
        setStatus('Not ready — try again in a moment.', true);
        return;
      }
      var available = slots.filter(function(s) { return !s.taken; });
      if (picked.length > available.length) {
        setStatus(
          'Picked ' + picked.length + ' files but only ' + available.length +
          ' slot' + (available.length === 1 ? '' : 's') + ' remaining. ' +
          'Re-run the tool with a higher max_files to allow more.',
          true,
        );
        return;
      }
      // Wrong-kind sanity check — file picker accept attribute filters most
      // mistakes but the camera capture path can still hand back odd MIMEs
      // on some browsers (e.g. video/quicktime when picking an image).
      for (var i = 0; i < picked.length; i++) {
        if (!picked[i].type || picked[i].type.indexOf(ACCEPT_PREFIX) !== 0) {
          setStatus("That doesn't look like a " + NOUN + ' — pick a different file.', true);
          return;
        }
      }
      setStatus('');
      // Create rows + claim slots up-front so the UI shows everything in pick order.
      var jobs = [];
      for (var j = 0; j < picked.length; j++) {
        var file = picked[j];
        var slot = available[j];
        slot.taken = true;
        var ctrl = appendRow(file);
        var entry = { file: file, status: 'uploading', publicUrl: null };
        rows.push(entry);
        jobs.push({ slot: slot, file: file, ctrl: ctrl, entry: entry });
      }
      // Fire all in parallel — XHR uploads are independent + R2 handles
      // concurrent multipart writes fine.
      var results = await Promise.all(jobs.map(function(j) {
        return uploadOne(j.slot, j.file, j.ctrl).then(function(r) {
          if (r.ok) j.entry.publicUrl = r.publicUrl;
          else j.entry.status = 'failed';
          return r;
        });
      }));
      var failed = results.filter(function(r) { return !r.ok; }).length;
      if (failed > 0) {
        setStatus(failed + ' upload(s) failed — see rows above.', true);
        return;
      }
      // All good. Render the final preview grid and tell the LLM.
      renderFinal();
      announceToHost();
    }

    fileEl.addEventListener('change', function(e) {
      var fl = e.target.files;
      if (fl && fl.length > 0) handlePicked(Array.prototype.slice.call(fl));
    });

    dropEl.addEventListener('dragover', function(e) {
      e.preventDefault();
      dropEl.classList.add('over');
    });
    dropEl.addEventListener('dragleave', function() { dropEl.classList.remove('over'); });
    dropEl.addEventListener('drop', function(e) {
      e.preventDefault();
      dropEl.classList.remove('over');
      var fl = e.dataTransfer && e.dataTransfer.files;
      if (fl && fl.length > 0) handlePicked(Array.prototype.slice.call(fl));
    });

    // structuredContent arrives via mcp-tool-result. Two shapes accepted:
    //   1. New (preferred): { uploads: [{upload_url, public_url}, ...], ... }
    //   2. Old single-file: { upload_url, public_url, ... }
    // The single-file shape is wrapped into a one-element uploads array so
    // the rest of the widget treats both uniformly.
    window.addEventListener('mcp-tool-result', function(e) {
      var sc = (e.detail && e.detail.structuredContent) || {};
      if (Array.isArray(sc.uploads) && sc.uploads.length > 0) {
        slots = sc.uploads.map(function(u) { return { upload_url: u.upload_url, public_url: u.public_url, taken: false }; });
      } else if (sc.upload_url && sc.public_url) {
        slots = [{ upload_url: sc.upload_url, public_url: sc.public_url, taken: false }];
      }
      if (sc.prompt) prompt = sc.prompt;
    });
  })();
</script>
</body></html>`
}

// Back-compat alias — the previous file exported `buildUploadImageWidget`
// (image-only). Callers that haven't migrated yet still get the image
// build via the new generic function.
export const buildUploadImageWidget = (): string => buildUploadWidget("image")
