---
node_type: reduce
generated_at: 2026-09-27T12:51:25.299Z
generated_from: c607aa02c
---

# Reduce

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `reduce`
**Category:** utility
**Credit cost:** `0-25` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
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
  "label": "Choose Best",
  "strategyId": "pick-best-llm",
  "strategyConfig": {
    "criteria": "Pick the highest-quality result.",
    "inputKind": "text"
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
    "label": "Choose Best",
    "strategyId": "pick-best-llm",
    "strategyConfig": {
      "criteria": "Pick the highest-quality result.",
      "inputKind": "text"
    }
  }
}
```
<!-- AUTO-GEN:END examples -->
