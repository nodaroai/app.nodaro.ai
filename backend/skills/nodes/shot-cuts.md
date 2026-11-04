---
node_type: shot-cuts
generated_at: 2026-11-04T12:55:54.222Z
generated_from: 2cad74fa7
---

# Shot Cuts

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `shot-cuts`
**Category:** processing
**Credit cost:** `2` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `in`
**Outputs (source handles):** `json`, `firstFrames`, `lastFrames`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobProgress?: number`
- `videoUrl?: string`
- `frames?: boolean`
- `generatedJson?: ShotCutsResult`
- `generatedFirstFrames?: string[]`
- `generatedLastFrames?: string[]`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Shot Cuts",
  "frames": false,
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `shot_cuts`

**Input parameters:**
- `video_url`
- `video_asset_id`
- `frames`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "shot-cuts-1",
  "type": "shot-cuts",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Shot Cuts",
    "frames": false,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
