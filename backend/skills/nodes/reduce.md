---
node_type: reduce
generated_at: 2026-06-04T12:41:29.209Z
generated_from: 9bf1388db
---

# Reduce

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `reduce`
**Category:** utility
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `strategyId: ReduceStrategyId`
- `strategyConfig: Record<string, unknown>`

**Optional data fields:**
- `result?: string`
- `lastInputs?: string[]`
- `lastMeta?: ReduceMeta`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "Reduce",
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
  "id": "reduce-1",
  "type": "reduce",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Reduce",
    "strategyId": "concat",
    "strategyConfig": {
      "separator": "\n\n"
    }
  }
}
```
<!-- AUTO-GEN:END examples -->
