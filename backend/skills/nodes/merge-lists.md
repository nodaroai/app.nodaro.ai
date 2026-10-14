---
node_type: merge-lists
generated_at: 2026-10-14T00:02:38.359Z
generated_from: b83a9467d
---

# Merge Lists

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `merge-lists`
**Category:** utility
**Credit cost:** `0` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `deduplicate: boolean`

**Optional data fields:**
- `mode?: "concat" | "zip"`
- `listResults?: string[]`
- `__listResults?: string[]`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`

**Default data:**
```json
{
  "label": "Merge Lists",
  "mode": "concat",
  "deduplicate": false
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
  "id": "merge-lists-1",
  "type": "merge-lists",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Merge Lists",
    "mode": "concat",
    "deduplicate": false
  }
}
```
<!-- AUTO-GEN:END examples -->
