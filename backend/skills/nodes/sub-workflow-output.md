---
node_type: sub-workflow-output
generated_at: 2026-10-06T17:44:10.401Z
generated_from: cf92127ce
---

# Sub-Workflow Output

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `sub-workflow-output`
**Category:** utility
**Credit cost:** `0` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `routeId: string`
- `ports: SubWorkflowPort[]`
- `visibleOutputPortId: string`

**Default data:**
```json
{
  "label": "Sub-Workflow Output",
  "routeId": "",
  "ports": [
    {
      "id": "",
      "name": "Output",
      "mediaType": "any"
    }
  ],
  "visibleOutputPortId": ""
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "sub-workflow-output-1",
  "type": "sub-workflow-output",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Sub-Workflow Output",
    "routeId": "",
    "ports": [
      {
        "id": "",
        "name": "Output",
        "mediaType": "any"
      }
    ],
    "visibleOutputPortId": ""
  }
}
```
<!-- AUTO-GEN:END examples -->
