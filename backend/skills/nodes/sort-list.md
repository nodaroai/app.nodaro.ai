---
node_type: sort-list
generated_at: 2026-09-27T12:51:25.166Z
generated_from: c607aa02c
---

# Sort List

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `sort-list`
**Category:** utility
**Credit cost:** `0` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `field: string`
- `sortType: "auto" | "text" | "number" | "date"`
- `direction: "asc" | "desc"`

**Optional data fields:**
- `mode?: "dropdown" | "custom"`
- `listResults?: string[]`
- `__listResults?: string[]`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`

**Default data:**
```json
{
  "label": "Sort List",
  "field": "",
  "mode": "dropdown",
  "sortType": "auto",
  "direction": "asc"
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
  "id": "sort-list-1",
  "type": "sort-list",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Sort List",
    "field": "",
    "mode": "dropdown",
    "sortType": "auto",
    "direction": "asc"
  }
}
```
<!-- AUTO-GEN:END examples -->
