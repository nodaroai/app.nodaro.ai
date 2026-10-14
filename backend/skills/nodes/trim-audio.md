---
node_type: trim-audio
generated_at: 2026-10-14T00:02:35.060Z
generated_from: b83a9467d
---

# Trim Audio

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `trim-audio`
**Category:** processing
**Credit cost:** `11` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `in`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `audioFormat: "mp3" | "wav" | "aac"`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedAudioUrl?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Trim Audio",
  "audioFormat": "mp3",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `trim_audio`

**Input parameters:**
- `audio_url`
- `audio_asset_id`
- `video_url`
- `video_asset_id`
- `start_time`
- `end_time`
- `audio_format`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "trim-audio-1",
  "type": "trim-audio",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Trim Audio",
    "audioFormat": "mp3",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
