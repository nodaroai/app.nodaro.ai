---
node_type: suno-music-video
generated_at: 2026-05-18T13:23:37.419Z
generated_from: cb1e786d
---

# Music Video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `suno-music-video`
**Category:** ai
**Credit cost:** 1
**Inputs (target handles):** `audio`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `taskId: string`
- `audioId: string`

**Optional data fields:**
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `fieldMappings?: FieldMappings`

**Default data:**
```json
{
  "label": "Music Video",
  "taskId": "",
  "audioId": "",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `suno_music_video`

**Input parameters:**
- `audio_asset_id`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "suno-music-video-1",
  "type": "suno-music-video",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Music Video",
    "taskId": "",
    "audioId": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
