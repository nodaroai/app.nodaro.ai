---
node_type: transcode-video
generated_at: 2026-05-18T13:23:37.646Z
generated_from: cb1e786d
---

# Transcode Video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `transcode-video`
**Category:** processing
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `codec: "h264" | "h265"`
- `crf: number`
- `resolution: "original" | "1080p" | "720p" | "480p"`
- `audioBitrate: "128k" | "192k" | "256k" | "320k"`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Transcode Video",
  "codec": "h264",
  "crf": 23,
  "resolution": "original",
  "audioBitrate": "128k",
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
  "id": "transcode-video-1",
  "type": "transcode-video",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Transcode Video",
    "codec": "h264",
    "crf": 23,
    "resolution": "original",
    "audioBitrate": "128k",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
