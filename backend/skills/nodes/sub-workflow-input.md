---
node_type: sub-workflow-input
generated_at: 2026-05-18T13:23:37.829Z
generated_from: cb1e786d
---

# Sub-Workflow Input

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `sub-workflow-input`
**Category:** utility
**Credit cost:** 0
**Inputs (target handles):** (none)
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `routeId: string`
- `ports: SubWorkflowPort[]`

**Optional data fields:**
- `__injectedPortValues?: Record<string, string>`

**Default data:**
```json
{
  "label": "Sub-Workflow Input",
  "routeId": "",
  "ports": [
    {
      "id": "",
      "name": "Input",
      "mediaType": "any"
    }
  ]
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
  "id": "sub-workflow-input-1",
  "type": "sub-workflow-input",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Sub-Workflow Input",
    "routeId": "",
    "ports": [
      {
        "id": "",
        "name": "Input",
        "mediaType": "any"
      }
    ]
  }
}
```
<!-- AUTO-GEN:END examples -->
