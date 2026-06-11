---
node_type: video-retake
generated_at: 2026-06-11T18:52:24.885Z
generated_from: 36d155ff
---

# Retake Video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `video-retake`
**Category:** ai
**Credit cost:** 25
**Inputs (target handles):** `in`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `provider: "ltx-2.3-pro"`
- `retakeStartTime: number`
- `retakeDuration: number`
- `retakeMode: "replace_audio" | "replace_video" | "replace_audio_and_video"`
- `resolution: "1080p"`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `prompt?: string`
- `aspectRatio?: "16:9" | "9:16"`
- `fps?: 24 | 25 | 48 | 50`
- `generateAudio?: boolean`
- `repeatCount?: number`
- `selectedVideoNodeId?: string`
- `videoDurationSec?: number`
- `generatedVideoUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `videoPlayState?: "loop" | "paused" | "stopped"`
- `pausedAtTime?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`

**Default data:**
```json
{
  "label": "Retake Video",
  "provider": "ltx-2.3-pro",
  "prompt": "",
  "retakeStartTime": 0,
  "retakeDuration": 2,
  "retakeMode": "replace_audio_and_video",
  "resolution": "1080p",
  "aspectRatio": "16:9",
  "fps": 25,
  "generateAudio": true,
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
  "id": "video-retake-1",
  "type": "video-retake",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Retake Video",
    "provider": "ltx-2.3-pro",
    "prompt": "",
    "retakeStartTime": 0,
    "retakeDuration": 2,
    "retakeMode": "replace_audio_and_video",
    "resolution": "1080p",
    "aspectRatio": "16:9",
    "fps": 25,
    "generateAudio": true,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
