---
node_type: merge-lists
generated_at: 2026-06-04T12:41:29.149Z
generated_from: 9bf1388db
---

# Merge Lists

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `merge-lists`
**Category:** utility
**Credit cost:** 0
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
