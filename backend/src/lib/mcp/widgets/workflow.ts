/**
 * Workflow widget — vertical list of node status pills + outputs gallery for
 * multi-step DAG runs. Returned alongside text from `run_workflow`,
 * `run_app`, and dynamic `app_<slug>` / `component_<slug>` tools.
 *
 * Live updates: subscribes to `mcp-ui-message` events forwarded from the
 * orchestrator's `executionEvents` bridge (see `progress-emitter.ts` v2.0).
 * Wire format is text-based for simplicity:
 *   - `node:<nodeId>:<status>:<label?>`  → pill state change
 *   - `progress:<fraction>|<message>`    → step progress text
 *   - `output:<kind>:<url>`              → append to outputs grid
 *
 * Same DOM-construction safety rules as the single-job widgets:
 * `document.createElement` + `textContent` + `setAttribute` only — never
 * raw HTML assignment. The snapshot test guards.
 */
import { uiProtocolShim } from "./_common.js"
import { embedInitData } from "./builder.js"

interface WorkflowInitData {
  executionId: string
  name: string
  nodeStates?: Array<{ id: string; label: string; status: "queued" | "running" | "done" | "failed" }>
  outputs?: Array<{ url: string; kind: "image" | "video" | "audio" }>
}

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

export function buildWorkflowWidget(data: WorkflowInitData): string {
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8" />
<style>${WF_CSS}</style>
${embedInitData(data)}
${uiProtocolShim()}
</head>
<body>
<div class="header" id="header"></div>
<div class="nodes" id="nodes"></div>
<div class="progress" id="progress">Starting…</div>
<div class="outputs" id="outputs"></div>
<div class="actions">
  <button id="btn-open">Open in Nodaro</button>
</div>
<script>
  (function() {
    var INIT = window.__INIT__;
    var headerEl = document.getElementById('header');
    var nodesEl = document.getElementById('nodes');
    var progressEl = document.getElementById('progress');
    var outputsEl = document.getElementById('outputs');

    headerEl.textContent = INIT.name;

    // Track node order via an array so we render in insertion order; a
    // companion map gives O(1) lookup when an update arrives.
    var nodeOrder = [];
    var nodeMap = {};
    (INIT.nodeStates || []).forEach(function(n) {
      nodeOrder.push(n.id);
      nodeMap[n.id] = n;
    });

    function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

    function renderNodes() {
      clear(nodesEl);
      nodeOrder.forEach(function(id) {
        var n = nodeMap[id];
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

    document.getElementById('btn-open').addEventListener('click', function() {
      window.NodaroMCP.openLink('https://app.nodaro.ai/library/executions/' + INIT.executionId);
    });

    if (INIT.outputs) INIT.outputs.forEach(function(o) { addOutput(o.kind, o.url); });
    renderNodes();

    window.addEventListener('mcp-ui-message', function(e) {
      var msg = e.detail;
      if (!msg || !msg.content || !msg.content[0]) return;
      var text = msg.content[0].text || '';

      var nodeUpdate = text.match(/^node:([^:]+):(queued|running|done|failed)(?::(.*))?$/);
      if (nodeUpdate) {
        var id = nodeUpdate[1];
        var status = nodeUpdate[2];
        var lbl = nodeUpdate[3] || (nodeMap[id] && nodeMap[id].label) || id;
        if (!nodeMap[id]) nodeOrder.push(id);
        nodeMap[id] = { id: id, label: lbl, status: status };
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

export type { WorkflowInitData }
