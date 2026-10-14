---
node_type: suno-separate
generated_at: 2026-10-14T00:02:32.645Z
generated_from: b83a9467d
---

# Suno Separate

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `suno-separate`
**Category:** ai
**Credit cost:** `44` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `audio`
**Outputs (source handles):** `instrumental`, `vocals`

**Required data fields:**
- `label: string`
- `type: "separate_vocal" | "split_stem"`
- `taskId: string`
- `audioId: string`

**Optional data fields:**
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedAudioUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `vocalUrl?: string`
- `instrumentalUrl?: string`
- `stems?: Record<string, string>`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `fieldMappings?: FieldMappings`

**Default data:**
```json
{
  "label": "Suno Separate",
  "type": "separate_vocal",
  "taskId": "",
  "audioId": "",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `suno_separate_stems`

**Input parameters:**
- `audio_asset_id`
- `type`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "suno-separate-1",
  "type": "suno-separate",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Suno Separate",
    "type": "separate_vocal",
    "taskId": "",
    "audioId": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
