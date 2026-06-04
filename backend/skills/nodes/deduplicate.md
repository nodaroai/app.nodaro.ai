---
node_type: deduplicate
generated_at: 2026-06-04T12:41:29.137Z
generated_from: 9bf1388db
---

# Remove Duplicates

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `deduplicate`
**Category:** utility
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `field: string`

**Optional data fields:**
- `mode?: "dropdown" | "custom"`
- `listResults?: string[]`
- `__listResults?: string[]`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`

**Default data:**
```json
{
  "label": "Remove Duplicates",
  "field": "",
  "mode": "dropdown"
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
  "id": "deduplicate-1",
  "type": "deduplicate",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Remove Duplicates",
    "field": "",
    "mode": "dropdown"
  }
}
```
<!-- AUTO-GEN:END examples -->
