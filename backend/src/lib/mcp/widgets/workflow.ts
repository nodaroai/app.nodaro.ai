/**
 * Workflow widget — vertical list of node status pills + outputs gallery for
 * multi-step DAG runs.
 *
 * Static template registered at `ui://nodaro/widget/workflow`. The host
 * delivers per-call data via:
 *   - `ui/notifications/tool-input`       — initial workflow_id / inputs
 *   - `ui/notifications/tool-result`      — execution_id + initial nodeStates
 *   - `ui/message`                        — bridged `node:*`, `progress:*`,
 *                                           `output:*` text events from the
 *                                           orchestrator's executionEvents
 *                                           channel (see progress-emitter.ts)
 *
 * DOM-construction safety: `document.createElement` + `textContent` +
 * `setAttribute` only.
 */
import { uiProtocolShim } from "./_common.js"

const WF_CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; font: 14px system-ui, sans-serif; background: transparent; color: inherit; }
  .header { font-weight: 600; margin-bottom: 12px; }
  .nodes { display: flex; flex-direction: column; gap: 4px; }
  .node { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 6px; background: rgba(127,127,127,0.08); }
  .node.running { background: rgba(91,157,255,0.15); }
  .node.done { background: rgba(91,210,127,0.15); }
  .node.failed { background: rgba(255,91,91,0.15); }
  .pill { width: 8px; height: 8px; border-radius: 50%; background: #999; flex-shrink: 0; }
  .node.running .pill { background: #5b9dff; animation: pulse 1.5s infinite; }
  .node.done .pill { background: #5bd27f; }
  .node.failed .pill { background: #ff5b5b; }
  @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.5 } }
  .label { flex: 1; }
  .progress { font-size: 12px; opacity: 0.7; margin-top: 12px; }
  .outputs { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; margin-top: 12px; }
  .outputs img, .outputs video { width: 100%; border-radius: 6px; display: block; }
  .actions { display: flex; gap: 8px; margin-top: 12px; }
  button { padding: 6px 14px; border: 1px solid currentColor; background: transparent; color: inherit; border-radius: 6px; font-size: 13px; cursor: pointer; }
`

export function buildWorkflowWidgetTemplate(): string {
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8" />
<style>${WF_CSS}</style>
${uiProtocolShim()}
</head>
<body>
<div class="header" id="header">Workflow</div>
<div class="nodes" id="nodes"></div>
<div class="progress" id="progress">Starting…</div>
<div class="outputs" id="outputs"></div>
<div class="actions">
  <button id="btn-open">Open in Nodaro</button>
</div>
<script>
  (function() {
    var headerEl = document.getElementById('header');
    var nodesEl = document.getElementById('nodes');
    var progressEl = document.getElementById('progress');
    var outputsEl = document.getElementById('outputs');

    var state = { executionId: null, nodeOrder: [], nodeMap: {} };

    function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

    function renderNodes() {
      clear(nodesEl);
      state.nodeOrder.forEach(function(id) {
        var n = state.nodeMap[id];
        if (!n) return;
        var row = document.createElement('div');
        row.className = 'node ' + n.status;
        var pill = document.createElement('span');
        pill.className = 'pill';
        var label = document.createElement('span');
        label.className = 'label';
        label.textContent = n.label;
        row.appendChild(pill);
        row.appendChild(label);
        nodesEl.appendChild(row);
      });
    }

    function addOutput(kind, url) {
      var el;
      if (kind === 'video') { el = document.createElement('video'); el.controls = true; }
      else if (kind === 'audio') { el = document.createElement('audio'); el.controls = true; }
      else { el = document.createElement('img'); el.setAttribute('alt', ''); }
      el.setAttribute('src', url);
      outputsEl.appendChild(el);
    }

    function ingestInitialNodeStates(list) {
      if (!Array.isArray(list)) return;
      list.forEach(function(n) {
        if (!n || !n.id) return;
        if (state.nodeMap[n.id]) return;
        state.nodeOrder.push(n.id);
        state.nodeMap[n.id] = { id: n.id, label: n.label || n.id, status: n.status || 'queued' };
      });
      renderNodes();
    }

    document.getElementById('btn-open').addEventListener('click', function() {
      window.NodaroMCP.openLink('https://app.nodaro.ai/gallery');
    });

    window.addEventListener('mcp-tool-result', function(e) {
      var sc = (e.detail && e.detail.structuredContent) || {};
      if (sc.executionId) state.executionId = sc.executionId;
      if (sc.name) headerEl.textContent = sc.name;
      ingestInitialNodeStates(sc.nodeStates);
      if (Array.isArray(sc.outputs)) sc.outputs.forEach(function(o) { addOutput(o.kind, o.url); });
      // Stateless HTTP MCP can't deliver async progress notifications —
      // the orchestrator runs in BullMQ AFTER the tool call returns and
      // the server tears down before its events can flow back via
      // ui/message. Polling get_app_run every 2s is the only reliable
      // way to surface live progress to the widget.
      if (state.executionId) startPolling();
    });

    // ── Poll loop ──
    var pollTimer = null;
    var pollAttempt = 0;
    var POLL_MS = 2000;
    var MAX_POLL_MS = 10 * 60 * 1000; // give up after 10 minutes
    var seenOutputs = {};

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
        progressEl.textContent = 'Still working — check Nodaro library.';
        return;
      }
      if (!state.executionId) return;
      var reqId = 'wf-poll-' + state.executionId + '-' + pollAttempt;
      window.parent.postMessage({
        jsonrpc: '2.0', id: reqId,
        method: 'tools/call',
        params: { name: 'get_app_run', arguments: { execution_id: state.executionId } }
      }, '*');
    }
    window.addEventListener('message', function(ev) {
      var data = ev.data;
      if (!data || data.jsonrpc !== '2.0' || !data.id) return;
      if (typeof data.id !== 'string' || data.id.indexOf('wf-poll-') !== 0) return;
      if (data.error) return;
      var sc = (data.result && data.result.structuredContent) || {};

      // Update node pills from polled state.
      if (Array.isArray(sc.nodeStates)) {
        sc.nodeStates.forEach(function(n) {
          if (!n || !n.id) return;
          if (!state.nodeMap[n.id]) state.nodeOrder.push(n.id);
          // Map orchestrator statuses (pending/running/completed/failed/skipped)
          // onto the widget's CSS classes (queued/running/done/failed).
          var s = n.status;
          var ws = s === 'pending' ? 'queued'
                 : s === 'completed' || s === 'skipped' ? 'done'
                 : s === 'running' ? 'running'
                 : s === 'failed' ? 'failed' : 'queued';
          state.nodeMap[n.id] = { id: n.id, label: n.label || n.id, status: ws };
        });
        renderNodes();
      }

      // Add any newly-produced outputs we haven't already rendered.
      if (Array.isArray(sc.outputs)) {
        sc.outputs.forEach(function(o) {
          var key = (o.kind || '') + '|' + (o.url || '');
          if (!o.url || seenOutputs[key]) return;
          seenOutputs[key] = true;
          addOutput(o.kind, o.url);
        });
      }

      // Stop polling on terminal status; show a short summary.
      if (sc.status === 'completed') {
        progressEl.textContent = 'Done';
        stopPolling();
      } else if (sc.status === 'failed' || sc.status === 'cancelled') {
        progressEl.textContent = 'Run ' + sc.status;
        stopPolling();
      } else if (sc.status === 'running') {
        progressEl.textContent = 'Running…';
      }
    });

    // Live updates from progress-emitter bridged into the iframe via
    // ui/message text events. Wire format:
    //   node:<id>:<status>:<label?>
    //   progress:<fraction>|<message>
    //   output:<kind>:<url>
    window.addEventListener('mcp-ui-message', function(e) {
      var msg = e.detail || {};
      if (!msg.content || !msg.content[0]) return;
      var text = msg.content[0].text || '';

      var nodeUpdate = text.match(/^node:([^:]+):(queued|running|done|failed)(?::(.*))?$/);
      if (nodeUpdate) {
        var id = nodeUpdate[1];
        var status = nodeUpdate[2];
        var lbl = nodeUpdate[3] || (state.nodeMap[id] && state.nodeMap[id].label) || id;
        if (!state.nodeMap[id]) state.nodeOrder.push(id);
        state.nodeMap[id] = { id: id, label: lbl, status: status };
        renderNodes();
        return;
      }

      var prog = text.match(/^progress:\\s*([\\d.]+)\\s*\\|\\s*(.+)$/);
      if (prog) {
        progressEl.textContent = 'Step: ' + prog[2] + ' (' + Math.round(parseFloat(prog[1]) * 100) + '%)';
        return;
      }

      var output = text.match(/^output:(image|video|audio):(https?:\\/\\/[^\\s]+)$/);
      if (output) {
        addOutput(output[1], output[2]);
        progressEl.textContent = 'Done';
      }
    });
  })();
</script>
</body></html>`
}

export interface WorkflowInitData {
  executionId: string
  name: string
  nodeStates?: Array<{
    id: string
    label: string
    status: "queued" | "running" | "done" | "failed"
  }>
  outputs?: Array<{ url: string; kind: "image" | "video" | "audio" }>
}

// Back-compat alias for older callers in tools/workflows.ts and dynamic.ts
// that still pass per-call init data. The template is now static and the
// data flows via tool-result events.
export const buildWorkflowWidget = (_d?: WorkflowInitData): string =>
  buildWorkflowWidgetTemplate()
