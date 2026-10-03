---
node_type: silence-detect
generated_at: 2026-09-27T12:51:24.156Z
generated_from: c607aa02c
---

# Silence Detect

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `silence-detect`
**Category:** processing
**Credit cost:** `10` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `in`
**Outputs (source handles):** `json`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `thresholdDb?: number`
- `minSilenceMs?: number`
- `padMs?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `generatedJson?: unknown`
- `fieldMappings?: Record<string, unknown>`

**Default data:**
```json
{
  "label": "Silence Detect",
  "thresholdDb": -35,
  "minSilenceMs": 700,
  "padMs": 120,
  "fieldMappings": {}
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
  "id": "silence-detect-1",
  "type": "silence-detect",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Silence Detect",
    "thresholdDb": -35,
    "minSilenceMs": 700,
    "padMs": 120,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
