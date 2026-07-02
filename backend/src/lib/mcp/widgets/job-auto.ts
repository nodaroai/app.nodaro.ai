/**
 * job-auto widget — the universal job card for verbs without a dedicated
 * media widget (entity motion clips, video-director renders, shot-sequence
 * renders, run_component, and the text-output verbs: image_to_text,
 * generate_script, transcribe, suno_lyrics, suno_style_boost,
 * forced_alignment).
 *
 * Unlike buildSingleJobWidget (which is specialised per media kind at build
 * time), this template decides WHAT to render at COMPLETION time from the
 * get_asset response: media URL → player/img, known text keys → inline text
 * blocks with Copy, component handle-map → stacked outputs, nothing → library
 * fallback. The decision logic lives in JOB_AUTO_CLASSIFY_JS — a pure JS
 * function source string embedded into the template AND evaluated directly
 * by the vitest decision-matrix suite (widgets/__tests__/job-auto.test.ts),
 * so the tree is testable without a DOM.
 *
 * Poll cap is 15 minutes (vs single-job's 5) — video-director / explainer
 * renders legitimately run long. 2s interval ≈ 30 req/min per active widget,
 * within the 600/min per-token budget (routes/mcp.ts).
 *
 * Same DOM-construction safety rules as every widget: createElement +
 * textContent + setAttribute ONLY. NO apostrophes inside JS string literals
 * (rendered-JS SyntaxError class — guarded by widget-js-valid.test.ts).
 */
import { uiProtocolShim } from "./_common.js"
import { WIDGET_MEDIA_ORIGINS } from "./csp-origins.js"
import { appBaseUrl } from "../../deployment-urls.js"

const CARD_CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 12px; font: 14px system-ui, sans-serif; background: transparent; color: inherit; }
  .card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    border: 1px solid rgba(127,127,127,0.18);
    background: rgba(127,127,127,0.04);
    border-radius: 14px;
    padding: 12px;
  }
  .progress { height: 4px; background: rgba(127,127,127,0.2); border-radius: 2px; overflow: hidden; }
  .progress > div { height: 100%; background: linear-gradient(90deg, #5b9dff, #8e6bff); width: 0%; transition: width .3s; }
  .meta { font-size: 12px; opacity: 0.7; display: flex; gap: 8px; flex-wrap: wrap; }
  .meta .badge { background: rgba(127,127,127,0.15); padding: 2px 8px; border-radius: 4px; }
  .status { font-size: 13px; opacity: 0.85; }
  .outputs { display: flex; flex-direction: column; gap: 10px; }
  .outputs img, .outputs video {
    display: block;
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: 420px;
    border-radius: 8px;
    margin: 0 auto;
  }
  .outputs audio { display: block; width: 100%; }
  .txt-block { border: 1px solid rgba(127,127,127,0.15); border-radius: 8px; padding: 10px; }
  .txt-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px; }
  .txt-title { font-size: 12px; font-weight: 600; opacity: 0.8; }
  .txt-body { font-size: 13px; line-height: 1.5; white-space: pre-wrap; overflow-y: auto; max-height: 320px; word-break: break-word; }
  .txt-body.json { font-family: ui-monospace, monospace; font-size: 12px; }
  .more-note { font-size: 12px; opacity: 0.6; }
  button { padding: 4px 10px; border: none; background: rgba(127,127,127,0.12); color: inherit; border-radius: 6px; font-size: 12px; cursor: pointer; font-family: inherit; opacity: 0.8; transition: opacity .15s; }
  button:hover { opacity: 1; }
  .media-actions { display: flex; gap: 6px; justify-content: flex-end; }
  a { color: inherit; }
`

/**
 * The known text-output keys of `jobs.output_data`, in the exact priority
 * order the classify function checks them (rule 2). Single source of truth
 * shared with get_asset's warn suppression (tools/gallery.ts) — adding a new
 * text-output verb means extending this list AND adding its renderer branch
 * to JOB_AUTO_CLASSIFY_JS below; the drift-guard test in
 * widgets/__tests__/job-auto.test.ts fails if the two fall out of sync.
 */
export const JOB_AUTO_TEXT_OUTPUT_KEYS = [
  "script",
  "lyrics",
  "generatedText",
  "alignment",
  "text",
] as const

/**
 * Pure decision function, embedded into the widget AND unit-tested via
 * node:vm. Input: get_asset structuredContent ({ outputUrl, assetKind,
 * outputData }). Output: Array<{ kind, value, title? }> where kind is one of
 * video | image | audio | link | text | json. Empty array = nothing
 * renderable (widget falls back to the library pointer).
 *
 * NOTE: plain ES5, no apostrophes in string literals, no template literals —
 * this string is embedded inside a TS template literal.
 */
export const JOB_AUTO_CLASSIFY_JS = `
function classifyJobOutput(sc, allowedOrigins) {
  sc = sc || {};
  var od = (sc.outputData && typeof sc.outputData === "object") ? sc.outputData : {};

  function originAllowed(url) {
    var m = /^(https:\\/\\/[^\\/]+)/.exec(url);
    if (!m) return false;
    var origin = m[1];
    for (var i = 0; i < allowedOrigins.length; i++) {
      var p = allowedOrigins[i];
      if (p.indexOf("https://*.") === 0) {
        var suffix = p.slice(10); // strip "https://*."
        var tail = "." + suffix;
        if (origin.length > 8 + tail.length && origin.slice(-tail.length) === tail) return true;
      } else if (origin === p) {
        return true;
      }
    }
    return false;
  }

  function sniffKind(url, hint) {
    if (!originAllowed(url)) return "link";
    if (hint === "video" || hint === "image" || hint === "audio") return hint;
    var path = String(url).split("#")[0].split("?")[0].toLowerCase();
    if (/\\.(png|jpg|jpeg|webp|gif)$/.test(path)) return "image";
    if (/\\.(mp4|webm|mov)$/.test(path)) return "video";
    if (/\\.(wav|mp3|m4a|ogg|flac)$/.test(path)) return "audio";
    return "link";
  }

  function jsonStr(v) {
    try { return JSON.stringify(v, null, 2); } catch (e) { return String(v); }
  }

  // Rule 1 — normalized media URL from get_asset.
  if (sc.outputUrl && typeof sc.outputUrl === "string") {
    return [{ kind: sniffKind(sc.outputUrl, sc.assetKind), value: sc.outputUrl }];
  }

  // Rule 2 — known text keys, priority order. alignment MUST outrank text:
  // forced_alignment writes both and its text is the callers input
  // transcript echoed back (workers/handlers/audio-ai.ts).
  if (od.script !== undefined) {
    var s = od.script;
    if (s && typeof s === "object" && Array.isArray(s.scenes)) {
      var lines = [];
      for (var i = 0; i < s.scenes.length; i++) {
        var scn = s.scenes[i] || {};
        if (scn.visualDescription || scn.action) {
          var head = "Scene " + (scn.sceneNumber !== undefined ? scn.sceneNumber : i + 1);
          if (scn.sceneName) head += " — " + scn.sceneName;
          head += ": " + (scn.visualDescription || "");
          lines.push(head);
          if (scn.action) lines.push(scn.action);
          if (Array.isArray(scn.dialogue)) {
            for (var d = 0; d < scn.dialogue.length; d++) {
              var dl = scn.dialogue[d] || {};
              lines.push((dl.character || "") + ": " + (dl.line || ""));
            }
          }
          lines.push("");
        } else {
          lines.push(jsonStr(scn));
          lines.push("");
        }
      }
      return [{ kind: "text", title: typeof s.title === "string" ? s.title : undefined, value: lines.join("\\n").trim() }];
    }
    return [{ kind: "json", value: jsonStr(s) }];
  }
  if (od.lyrics !== undefined) {
    var ly = od.lyrics;
    if (Array.isArray(ly)) {
      var items = [];
      for (var j = 0; j < ly.length; j++) {
        var v = ly[j] || {};
        items.push({ kind: "text", title: v.title, value: typeof v.text === "string" ? v.text : jsonStr(v) });
      }
      return items;
    }
    if (typeof ly === "string") return [{ kind: "text", value: ly }];
    return [{ kind: "json", value: jsonStr(ly) }];
  }
  if (od.generatedText !== undefined && typeof od.generatedText === "string") {
    return [{ kind: "text", value: od.generatedText }];
  }
  if (od.alignment !== undefined) {
    return [{ kind: "json", value: jsonStr(od.alignment) }];
  }
  if (od.text !== undefined && typeof od.text === "string") {
    return [{ kind: "text", value: od.text }];
  }

  // Rule 3 — component handle-map fallback: every non-underscore key with a
  // string value. URL values render as media (CSP-allowlisted origins only —
  // off-list origins get a link, the host would hard-block the media load).
  // Beyond CAP outputs, a trailing note item says how many more exist so the
  // truncation is never silent.
  var CAP = 6;
  var out = [];
  var overflow = 0;
  for (var key in od) {
    if (!Object.prototype.hasOwnProperty.call(od, key)) continue;
    if (key.charAt(0) === "_") continue;
    var val = od[key];
    if (typeof val !== "string" || !val) continue;
    if (out.length >= CAP) { overflow++; continue; }
    if (/^https?:\\/\\//.test(val)) {
      out.push({ kind: sniffKind(val, null), value: val, title: key });
    } else {
      out.push({ kind: "text", value: val, title: key });
    }
  }
  if (overflow > 0) {
    out.push({ kind: "note", value: "+" + overflow + " more in your Nodaro library" });
  }
  return out;
}
`

/**
 * Builds the static job-auto widget HTML. Registered once per request by the
 * resource registrar under ui://nodaro/widget/v4/job-auto.
 */
export function buildJobAutoWidget(): string {
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8" />
<style>${CARD_CSS}</style>
${uiProtocolShim()}
</head>
<body>
<div class="card">
  <div class="meta" id="meta"></div>
  <div class="status" id="status">Initializing…</div>
  <div class="progress" id="progress"><div id="bar"></div></div>
  <div class="outputs" id="outputs" hidden></div>
</div>
<script>
  ${JOB_AUTO_CLASSIFY_JS}
  (function() {
    var ALLOWED_ORIGINS = ${JSON.stringify(WIDGET_MEDIA_ORIGINS)};
    var state = { jobId: null, prompt: null, model: null, done: false };

    var metaEl = document.getElementById('meta');
    var statusEl = document.getElementById('status');
    var progEl = document.getElementById('progress');
    var barEl = document.getElementById('bar');
    var outputsEl = document.getElementById('outputs');

    function renderMeta() {
      while (metaEl.firstChild) metaEl.removeChild(metaEl.firstChild);
      [state.model].forEach(function(v) {
        if (!v) return;
        var span = document.createElement('span');
        span.className = 'badge';
        span.textContent = String(v);
        metaEl.appendChild(span);
      });
    }

    function copyButton(getText) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Copy';
      b.addEventListener('click', function() {
        var t = getText();
        if (t && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(t).catch(function() {});
          b.textContent = 'Copied';
          setTimeout(function() { b.textContent = 'Copy'; }, 1500);
        }
      });
      return b;
    }

    function renderTextBlock(item) {
      var block = document.createElement('div');
      block.className = 'txt-block';
      var head = document.createElement('div');
      head.className = 'txt-head';
      var title = document.createElement('span');
      title.className = 'txt-title';
      title.textContent = item.title || (item.kind === 'json' ? 'Output (JSON)' : 'Output');
      head.appendChild(title);
      head.appendChild(copyButton(function() { return item.value; }));
      block.appendChild(head);
      var body = document.createElement('div');
      body.className = 'txt-body' + (item.kind === 'json' ? ' json' : '');
      body.textContent = item.value;
      block.appendChild(body);
      return block;
    }

    function renderMediaBlock(item) {
      var wrap = document.createElement('div');
      var media;
      if (item.kind === 'video') {
        media = document.createElement('video');
        media.controls = true;
        media.setAttribute('preload', 'metadata');
        media.setAttribute('playsinline', '');
      } else if (item.kind === 'audio') {
        media = document.createElement('audio');
        media.controls = true;
      } else {
        media = document.createElement('img');
        media.setAttribute('alt', item.title || '');
      }
      media.setAttribute('src', item.value);
      // If the asset fails to load (CSP edge case, deleted object), swap the
      // dead media element for a plain link so the user still has a path.
      media.addEventListener('error', function() {
        if (!wrap.parentNode) return;
        wrap.replaceChild(renderLinkBlock(item), media);
      });
      wrap.appendChild(media);
      var actions = document.createElement('div');
      actions.className = 'media-actions';
      var dl = document.createElement('button');
      dl.type = 'button';
      dl.textContent = 'Download';
      dl.addEventListener('click', function() {
        if (window.NodaroMCP && window.NodaroMCP.openLink) window.NodaroMCP.openLink(item.value);
      });
      actions.appendChild(dl);
      actions.appendChild(copyButton(function() { return item.value; }));
      wrap.appendChild(actions);
      return wrap;
    }

    function renderLinkBlock(item) {
      var a = document.createElement('a');
      // Scheme guard (defense in depth): only http(s) values become a
      // clickable href — anything else renders as inert text. classify only
      // URL-classifies https?:// values today; this guards the rule-1
      // outputUrl path against a hostile scheme ever reaching output_data.
      if (item.value.indexOf('https://') === 0 || item.value.indexOf('http://') === 0) {
        a.setAttribute('href', item.value);
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener');
      }
      a.textContent = (item.title ? item.title + ': ' : '') + 'View output';
      return a;
    }

    function renderNoteBlock(item) {
      var note = document.createElement('div');
      note.className = 'more-note';
      note.textContent = item.value;
      return note;
    }

    function showResult(sc) {
      if (state.done) return;
      var items = classifyJobOutput(sc, ALLOWED_ORIGINS);
      if (!items.length) {
        // Rule 4 — nothing resolvable. Library pointer is the last resort.
        showLibraryFallback('Done — saved to your Nodaro library. ');
        state.done = true;
        stopPolling();
        return;
      }
      state.done = true;
      stopPolling();
      while (outputsEl.firstChild) outputsEl.removeChild(outputsEl.firstChild);
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item.kind === 'text' || item.kind === 'json') outputsEl.appendChild(renderTextBlock(item));
        else if (item.kind === 'link') outputsEl.appendChild(renderLinkBlock(item));
        else if (item.kind === 'note') outputsEl.appendChild(renderNoteBlock(item));
        else outputsEl.appendChild(renderMediaBlock(item));
      }
      outputsEl.hidden = false;
      progEl.hidden = true;
      statusEl.style.display = 'none';
      if (window.NodaroMCP && window.NodaroMCP.notifySizeChange) window.NodaroMCP.notifySizeChange();
    }

    function showLibraryFallback(prefixText) {
      progEl.hidden = true;
      while (statusEl.firstChild) statusEl.removeChild(statusEl.firstChild);
      statusEl.appendChild(document.createTextNode(prefixText));
      var libLink = document.createElement('button');
      libLink.type = 'button';
      libLink.textContent = 'Open Nodaro library';
      libLink.addEventListener('click', function() {
        if (window.NodaroMCP && window.NodaroMCP.openLink) {
          window.NodaroMCP.openLink(${JSON.stringify(`${appBaseUrl()}/gallery`)});
        }
      });
      statusEl.appendChild(libLink);
      statusEl.style.display = '';
    }

    // Tool args arrive before the result. Status stays Loading (NOT
    // Generating) — this event also fires when re-opening old chats.
    window.addEventListener('mcp-tool-input', function(e) {
      var args = (e.detail && e.detail.arguments) || {};
      state.prompt = args.prompt || args.motion_prompt || args.topic || args.brief || args.transcript || state.prompt;
      state.model = args.model || args.provider || args.component_id || state.model;
      renderMeta();
      statusEl.textContent = 'Loading…';
    });

    var sawToolResult = false;
    window.addEventListener('mcp-tool-result', function(e) {
      sawToolResult = true;
      if (e.detail && e.detail.isError) {
        statusEl.textContent = 'Failed — see the message above.';
        progEl.hidden = true;
        return;
      }
      var sc = (e.detail && e.detail.structuredContent) || {};
      if (sc.jobId) state.jobId = sc.jobId;
      if (sc.model) state.model = sc.model;
      if (sc.prompt) state.prompt = sc.prompt;
      renderMeta();
      if (sc.outputUrl) {
        showResult(sc);
      } else if (state.jobId) {
        statusEl.textContent = 'Working…';
        startPolling();
      } else {
        statusEl.textContent = 'No result returned.';
      }
    });

    // Stuck-card recovery: if the host never delivers tool-result (dropped
    // notification / rejected handshake), stop pretending after 15s.
    setTimeout(function() {
      if (sawToolResult || state.done) return;
      showLibraryFallback('Your result will appear at the top of your Nodaro library when ready. ');
    }, 15000);

    // ── Poll loop: tools/call get_asset every 2s, 15-minute cap ──
    // (single-job uses 5 min; video-director / explainer renders run longer)
    var pollTimer = null;
    var pollAttempt = 0;
    var POLL_MS = 2000;
    var MAX_POLL_MS = 15 * 60 * 1000;

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
      var reqId = 'poll-' + state.jobId + '-' + pollAttempt;
      window.parent.postMessage({
        jsonrpc: '2.0', id: reqId,
        method: 'tools/call',
        params: { name: 'get_asset', arguments: { job_id: state.jobId } }
      }, '*');
    }

    window.addEventListener('message', function(ev) {
      var data = ev.data;
      if (!data || data.jsonrpc !== '2.0' || !data.id) return;
      if (typeof data.id !== 'string' || data.id.indexOf('poll-') !== 0) return;
      if (data.error) { return; }
      if (data.result && data.result.isError) {
        stopPolling();
        statusEl.textContent = 'Could not load — check Nodaro library.';
        return;
      }
      var sc = (data.result && data.result.structuredContent) || {};
      if (typeof sc.progress === 'number' && !state.done) {
        var pct = sc.progress > 1 ? sc.progress : sc.progress * 100;
        barEl.style.width = pct.toFixed(1) + '%';
        statusEl.textContent = 'Working… ' + Math.round(pct) + '%';
      }
      if (sc.status === 'failed' || sc.status === 'cancelled') {
        statusEl.textContent = 'Job ' + sc.status;
        progEl.hidden = true;
        stopPolling();
        return;
      }
      if (sc.status === 'completed') {
        showResult(sc);
      }
    });
  })();
</script>
</body></html>`
}
