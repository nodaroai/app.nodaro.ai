---
node_type: ugc-finish-clips
generated_at: 2026-10-12T20:07:36.343Z
generated_from: 4d79ce1a6
---

# UGC Finish

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `ugc-finish-clips`
**Category:** ai
**Credit cost:** `0` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `clips`, `plan`
**Outputs (source handles):** `video-out`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `generatedVideoUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`
- `__listResults?: string[]`
- `__listResultMeta?: FanOutItemMeta[]`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "UGC Finish",
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
  "id": "ugc-finish-clips-1",
  "type": "ugc-finish-clips",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "UGC Finish",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
