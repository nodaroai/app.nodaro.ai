---
node_type: ugc-clips
generated_at: 2026-10-14T00:02:34.462Z
generated_from: b83a9467d
---

# UGC Clips

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `ugc-clips`
**Category:** ai
**Credit cost:** `0` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `plan`, `creator`
**Outputs (source handles):** `clips`, `plan-out`, `transcript`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `voiceId?: string`
- `voiceDisplayName?: string`
- `quote?: { lines: { label: string; credits: number; key?: string; n?: number; seconds?: number }[]; expected: number; ceiling: number }`
- `result?: Record<string, unknown>`
- `ugcOutputs?: Record<string, string>`
- `__listResults?: string[]`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "UGC Clips",
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
  "id": "ugc-clips-1",
  "type": "ugc-clips",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "UGC Clips",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
