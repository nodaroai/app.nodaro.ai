/**
 * Recast widget (spec 2026-08-06 §6 — P3) — the status/choice card for the
 * MCP movie lane: stage progress, the growing preview / final film, and the
 * interactive gates (cast / identity sheet / scene stills / music) rendered
 * as pick-1-of-3 choices IN the card. A window onto the run, never a second
 * UI — anything it cannot show is one click away via "Open in Recast".
 *
 * The SHEET gate (C7, 2026-08-07 doctrine) opens after the cast pick: per
 * person slot, 3 composed identity sheets whose face panel is the SAME chosen
 * portrait in all three — the user is choosing body & wardrobe only. Sheets
 * are landscape multi-panel composites (unlike the portrait cast candidates),
 * so their options stack full-width instead of sharing a 3-up grid.
 *
 * Static template registered at `ui://nodaro/widget/v5/recast`. Per-call data
 * arrives via the host's `ui/notifications/tool-result` event from
 * `get_recast_status`; while the run is live the widget polls that same FREE
 * tool via `tools/call`. A gate pick calls `resolve_recast_gate` (the pick
 * itself is free, pure state — the interactive surcharge was consented at
 * start_recast). The widget NEVER calls a purchasing verb.
 *
 * DOM-construction safety: `document.createElement` + `textContent` +
 * `setAttribute` only.
 */
import { uiProtocolShim } from "./_common.js"

const CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; font: 14px system-ui, sans-serif; background: transparent; color: inherit; }
  .header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .title { font-weight: 600; flex: 1; }
  .status { font-size: 12px; padding: 2px 10px; border-radius: 999px; background: rgba(127,127,127,0.15); }
  .status.generating { background: rgba(91,157,255,0.2); }
  .status.completed { background: rgba(91,210,127,0.2); }
  .status.failed { background: rgba(255,91,91,0.2); }
  .bar { height: 6px; border-radius: 3px; background: rgba(127,127,127,0.15); overflow: hidden; margin-bottom: 10px; }
  .bar > div { height: 100%; width: 0; background: #5b9dff; transition: width 0.6s; }
  .stage { margin-bottom: 10px; }
  .stage video { width: 100%; border-radius: 8px; display: block; background: #000; }
  .note { font-size: 12px; opacity: 0.7; margin: 8px 0; }
  .gate { margin-top: 12px; }
  .gate-title { font-weight: 600; margin-bottom: 6px; }
  .gate-brief { font-size: 12px; opacity: 0.75; margin-bottom: 8px; }
  .options { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .options.wide { grid-template-columns: 1fr; }
  .opt { position: relative; border: 2px solid transparent; border-radius: 8px; overflow: hidden; cursor: pointer; padding: 0; background: rgba(127,127,127,0.08); }
  .opt img { width: 100%; display: block; }
  .opt.picked { border-color: #5bd27f; }
  .opt .tag { position: absolute; left: 6px; top: 6px; font-size: 11px; background: rgba(0,0,0,0.55); color: #fff; padding: 1px 7px; border-radius: 999px; }
  .opt-audio { display: flex; flex-direction: column; gap: 4px; padding: 8px; cursor: default; }
  .opt-audio audio { width: 100%; }
  .opt-audio button { align-self: flex-start; }
  .actions { display: flex; gap: 8px; margin-top: 12px; }
  button { padding: 6px 14px; border: 1px solid currentColor; background: transparent; color: inherit; border-radius: 6px; font-size: 13px; cursor: pointer; }
`

export function buildRecastWidgetTemplate(): string {
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8" />
<style>${CSS}</style>
${uiProtocolShim()}
</head>
<body>
<div class="header"><span class="title" id="title">Recast</span><span class="status" id="status">…</span></div>
<div class="bar" id="bar-wrap" hidden><div id="bar"></div></div>
<div class="stage" id="stage" hidden><video id="player" controls></video></div>
<div class="note" id="note" hidden></div>
<div class="gate" id="gate" hidden></div>
<div class="actions"><button id="btn-open">Open in Recast</button></div>
<script>
  (function() {
    var titleEl = document.getElementById('title');
    var statusEl = document.getElementById('status');
    var barWrap = document.getElementById('bar-wrap');
    var barEl = document.getElementById('bar');
    var stageEl = document.getElementById('stage');
    var playerEl = document.getElementById('player');
    var noteEl = document.getElementById('note');
    var gateEl = document.getElementById('gate');

    var state = { recastId: null, appUrl: null, lastVideo: null, busy: false, seq: 0 };

    function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

    function setVideo(url) {
      if (!url || url === state.lastVideo) return;
      state.lastVideo = url;
      // The live preview URL is superseded per segment (old object deleted) —
      // always swap the source and tolerate a brief 404 between polls.
      playerEl.setAttribute('src', url);
      stageEl.hidden = false;
    }

    function pick(args) {
      if (state.busy) return;
      state.busy = true;
      var reqId = 'recast-pick-' + (++state.seq);
      window.parent.postMessage({
        jsonrpc: '2.0', id: reqId, method: 'tools/call',
        params: { name: 'resolve_recast_gate', arguments: args }
      }, '*');
    }

    function imageOptions(container, urls, pickedUrl, makeArgs, wide) {
      var grid = document.createElement('div');
      grid.className = wide ? 'options wide' : 'options';
      (urls || []).forEach(function(url, i) {
        var b = document.createElement('button');
        b.className = 'opt' + (pickedUrl === url ? ' picked' : '');
        var img = document.createElement('img');
        img.setAttribute('src', url);
        img.setAttribute('alt', 'Option ' + (i + 1));
        var tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = String(i + 1);
        b.appendChild(img);
        b.appendChild(tag);
        b.addEventListener('click', function() { pick(makeArgs(i)); });
        grid.appendChild(b);
      });
      container.appendChild(grid);
    }

    function renderGate(interactive) {
      clear(gateEl);
      gateEl.hidden = true;
      if (!interactive) return;
      var g = interactive.pendingGate;
      var sh = interactive.pendingSheetGate;
      var a = interactive.pendingAnchorGate;
      var m = interactive.pendingMusicGate;
      if (g && g.slots) {
        gateEl.hidden = false;
        Object.keys(g.slots).forEach(function(slotId) {
          var slot = g.slots[slotId];
          if (!slot || !slot.candidates || slot.picked) return;
          var t = document.createElement('div');
          t.className = 'gate-title';
          t.textContent = 'Choose: ' + (slot.label || slotId);
          gateEl.appendChild(t);
          imageOptions(gateEl, slot.candidates, slot.picked, function(i) {
            var picks = {}; picks[slotId] = i;
            return { recast_id: state.recastId, picks: picks };
          });
        });
      } else if (sh && sh.slots) {
        // Sheet gate (C7): the face panel is the SAME chosen portrait in all
        // three sheets — the pick is body & wardrobe only. Wide options: a
        // sheet is a landscape multi-panel composite, illegible at 3-up.
        gateEl.hidden = false;
        Object.keys(sh.slots).forEach(function(slotId) {
          var slot = sh.slots[slotId];
          if (!slot || !slot.candidates || slot.picked) return;
          var t = document.createElement('div');
          t.className = 'gate-title';
          t.textContent = 'Body & wardrobe: ' + (slot.label || slotId);
          gateEl.appendChild(t);
          var brief = document.createElement('div');
          brief.className = 'gate-brief';
          brief.textContent = 'The face is locked from your cast pick — choose the body and clothes.';
          gateEl.appendChild(brief);
          imageOptions(gateEl, slot.candidates, slot.picked, function(i) {
            var picks = {}; picks[slotId] = i;
            return { recast_id: state.recastId, gate: 'sheet', picks: picks };
          }, true);
        });
      } else if (a) {
        gateEl.hidden = false;
        var at = document.createElement('div');
        at.className = 'gate-title';
        at.textContent = 'Scene ' + (a.segment + 1) + ' of ' + a.total + ' — opening frame';
        gateEl.appendChild(at);
        imageOptions(gateEl, a.start && a.start.candidates, a.start && a.start.picked, function(i) {
          return { recast_id: state.recastId, segment: a.segment, anchor_start: i };
        });
        if (a.end && a.end.candidates) {
          var et = document.createElement('div');
          et.className = 'gate-title';
          et.textContent = 'Closing frame';
          gateEl.appendChild(et);
          imageOptions(gateEl, a.end.candidates, a.end.picked, function(i) {
            return { recast_id: state.recastId, segment: a.segment, anchor_end: i };
          });
        }
      } else if (m) {
        gateEl.hidden = false;
        var mt = document.createElement('div');
        mt.className = 'gate-title';
        mt.textContent = 'Score ' + (m.section + 1) + ' of ' + m.total;
        gateEl.appendChild(mt);
        var brief = document.createElement('div');
        brief.className = 'gate-brief';
        brief.textContent = m.brief || '';
        gateEl.appendChild(brief);
        var wrap = document.createElement('div');
        wrap.className = 'options';
        (m.candidates || []).forEach(function(url, i) {
          var cell = document.createElement('div');
          cell.className = 'opt opt-audio';
          var audio = document.createElement('audio');
          audio.controls = true;
          audio.setAttribute('src', url);
          var b = document.createElement('button');
          b.textContent = 'Pick take ' + (i + 1);
          b.addEventListener('click', function() {
            pick({ recast_id: state.recastId, section: m.section, music_pick: i });
          });
          cell.appendChild(audio);
          cell.appendChild(b);
          wrap.appendChild(cell);
        });
        gateEl.appendChild(wrap);
      }
    }

    function render(sc) {
      if (!sc) return;
      if (sc.recastId) state.recastId = sc.recastId;
      if (sc.appUrl) state.appUrl = sc.appUrl;
      if (sc.title) titleEl.textContent = sc.title;
      var status = sc.status || sc.stage || '…';
      statusEl.textContent = status;
      statusEl.className = 'status ' + status;
      if (typeof sc.segmentsDone === 'number' && typeof sc.segmentsTotal === 'number' && sc.segmentsTotal > 0) {
        barWrap.hidden = false;
        barEl.style.width = Math.round((sc.segmentsDone / sc.segmentsTotal) * 100) + '%';
      }
      setVideo(sc.resultUrl || sc.previewUrl);
      if (sc.note) { noteEl.hidden = false; noteEl.textContent = sc.note; }
      renderGate(sc.interactive);
      var live = status === 'planning' || status === 'planned' || status === 'generating' || status === 'analyzing';
      if (live) startPolling(); else stopPolling();
    }

    document.getElementById('btn-open').addEventListener('click', function() {
      if (state.appUrl) window.NodaroMCP.openLink(state.appUrl);
    });

    window.addEventListener('mcp-tool-result', function(e) {
      render((e.detail && e.detail.structuredContent) || {});
    });

    // ── Poll loop (FREE status reads only — never a purchasing verb) ──
    var pollTimer = null;
    var pollAttempt = 0;
    var POLL_MS = 3000;
    var MAX_POLL_MS = 15 * 60 * 1000;

    function startPolling() {
      if (pollTimer) return;
      pollAttempt = 0;
      pollTimer = setInterval(pollOnce, POLL_MS);
    }
    function stopPolling() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }
    function pollOnce() {
      pollAttempt++;
      if (pollAttempt * POLL_MS > MAX_POLL_MS) {
        stopPolling();
        noteEl.hidden = false;
        noteEl.textContent = 'Still working — open Recast to keep watching.';
        return;
      }
      if (!state.recastId) return;
      window.parent.postMessage({
        jsonrpc: '2.0', id: 'recast-poll-' + state.recastId + '-' + pollAttempt,
        method: 'tools/call',
        params: { name: 'get_recast_status', arguments: { recast_id: state.recastId } }
      }, '*');
    }
    window.addEventListener('message', function(ev) {
      var data = ev.data;
      if (!data || data.jsonrpc !== '2.0' || typeof data.id !== 'string') return;
      var isPoll = data.id.indexOf('recast-poll-') === 0;
      var isPick = data.id.indexOf('recast-pick-') === 0;
      if (!isPoll && !isPick) return;
      if (isPick) state.busy = false;
      if (data.error) return;
      var sc = (data.result && data.result.structuredContent) || null;
      if (sc) render(sc);
    });
  })();
</script>
</body></html>`
}
