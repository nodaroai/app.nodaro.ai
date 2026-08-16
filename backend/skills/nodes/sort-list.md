---
node_type: sort-list
generated_at: 2026-08-15T21:55:09.206Z
generated_from: 150c80ac9
---

# Sort List

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `sort-list`
**Category:** utility
**Credit cost:** 0
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
