---
node_type: json-process
generated_at: 2026-06-04T12:41:29.107Z
generated_from: 9bf1388db
---

# JSON Process

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `json-process`
**Category:** utility
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `mode: "visual" | "advanced"`
- `inputPath: string`
- `filters: Array<{
    id: string
    field: string
    operator: "equals" | "not_equals" | "contains" | "not_contains" | "starts_with" | "ends_with" | "greater_than" | "less_than" | "is_empty" | "is_not_empty" | "matches_regex" | "in_list"
    value: string | string[]
  }>`
- `projections: string[]`
- `expression: string`

**Optional data fields:**
- `processedResult?: unknown`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`

**Default data:**
```json
{
  "label": "JSON Process",
  "mode": "visual",
  "inputPath": "",
  "filters": [],
  "projections": [],
  "expression": ""
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
  "id": "json-process-1",
  "type": "json-process",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "JSON Process",
    "mode": "visual",
    "inputPath": "",
    "filters": [],
    "projections": [],
    "expression": ""
  }
}
```
<!-- AUTO-GEN:END examples -->
