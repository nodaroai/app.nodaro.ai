---
node_type: collect
generated_at: 2026-05-21T13:11:05.755Z
generated_from: 1f6ec624
---

# Collect

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `collect`
**Category:** utility
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Default data:**
```json
{
  "label": "Collect",
  "strategyId": "concat",
  "strategyConfig": {
    "separator": "\n\n"
  }
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
  "id": "collect-1",
  "type": "collect",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Collect",
    "strategyId": "concat",
    "strategyConfig": {
      "separator": "\n\n"
    }
  }
}
```
<!-- AUTO-GEN:END examples -->
