---
node_type: filter-list
generated_at: 2026-06-04T12:41:29.125Z
generated_from: 9bf1388db
---

# Filter List

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `filter-list`
**Category:** utility
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `conditions: FilterListCondition[]`
- `conditionLogic: "AND" | "OR"`

**Optional data fields:**
- `caseSensitive?: boolean`
- `listResults?: string[]`
- `__listResults?: string[]`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`

**Default data:**
```json
{
  "label": "Filter List",
  "conditions": [],
  "conditionLogic": "AND",
  "caseSensitive": false
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
  "id": "filter-list-1",
  "type": "filter-list",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Filter List",
    "conditions": [],
    "conditionLogic": "AND",
    "caseSensitive": false
  }
}
```
<!-- AUTO-GEN:END examples -->
