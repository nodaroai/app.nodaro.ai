---
node_type: video-to-video
generated_at: 2026-09-27T12:51:23.319Z
generated_from: c607aa02c
---

# Video to Video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `video-to-video`
**Category:** ai
**Credit cost:** `250` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `video`, `cinematography`, `prompt`, `negative`, `imageReferences`, `audioReferences`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `prompt: string`
- `provider: VideoToVideoNodeProvider`
- `duration: number`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `promptPrefix?: string`
- `promptSuffix?: string`
- `negativePrompt?: string`
- `v2vDuration?: "5" | "10"`
- `v2vResolution?: "480p" | "720p" | "1080p"`
- `audio?: boolean`
- `multiShots?: boolean`
- `generateAudio?: boolean`
- `videoEditDuration?: "0" | "5" | "10"`
- `audioSetting?: "auto" | "origin"`
- `promptExtend?: boolean`
- `aspectRatio?: string`
- `seed?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `connectedImageOrder?: readonly string[]`
- `referenceOrder?: readonly string[]`
- `suppressedCanonicalCharacterIds?: readonly string[]`
- `suppressedCanonicalLocationIds?: readonly string[]`
- `extraRefs?: readonly ExtraRef[]`
- `videoPlayState?: "loop" | "paused" | "stopped"`
- `pausedAtTime?: number`

**Default data:**
```json
{
  "label": "Video to Video",
  "prompt": "",
  "duration": 5,
  "negativePrompt": "",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `modify_video`

**Input parameters:**
- `prompt`
- `video_url`
- `video_asset_id`
- `model`
- `duration`
- `resolution`
- `aspect_ratio`
- `audio`
- `multi_shots`
- `reference_image_url`
- `reference_image_urls`
- `seed`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "video-to-video-1",
  "type": "video-to-video",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Video to Video",
    "prompt": "",
    "duration": 5,
    "negativePrompt": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
