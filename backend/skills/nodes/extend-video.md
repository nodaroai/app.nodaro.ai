---
node_type: extend-video
generated_at: 2026-06-11T21:22:39.952Z
generated_from: 8b0f26429
---

# Extend Video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `extend-video`
**Category:** ai
**Credit cost:** 40
**Inputs (target handles):** `in`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `provider: ExtendVideoProvider`
- `prompt: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `negativePrompt?: string`
- `model?: "fast" | "quality"`
- `seeds?: number`
- `quality?: "720p" | "1080p"`
- `extendMode?: "start" | "end"`
- `duration?: number`
- `resolution?: "480p" | "720p" | "1080p"`
- `generateAudio?: boolean`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `kieTaskId?: string`
- `videoPlayState?: "loop" | "paused" | "stopped"`
- `pausedAtTime?: number`

**Default data:**
```json
{
  "label": "Extend Video",
  "provider": "veo-extend",
  "prompt": "",
  "negativePrompt": "",
  "fieldMappings": {},
  "executionStatus": "idle",
  "generatedResults": [],
  "activeResultIndex": 0
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `extend_video`

**Input parameters:**
- `prompt`
- `kie_task_id`
- `video_url`
- `video_asset_id`
- `model`
- `veo_quality`
- `runway_resolution`
- `duration`
- `resolution`
- `generate_audio`
- `seed`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "extend-video-1",
  "type": "extend-video",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Extend Video",
    "provider": "veo-extend",
    "prompt": "",
    "negativePrompt": "",
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
