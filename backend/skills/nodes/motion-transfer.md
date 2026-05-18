---
node_type: motion-transfer
generated_at: 2026-05-18T20:51:28.946Z
generated_from: af4193bd
---

# Motion Transfer

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `motion-transfer`
**Category:** ai
**Credit cost:** 30
**Inputs (target handles):** `image`, `video`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `prompt: string`
- `characterOrientation: "image" | "video"`
- `resolution: "720p" | "1080p" | "480p" | "580p"`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `provider?: "kling" | "kling-3.0" | "wan-animate-move" | "wan-animate-replace"`
- `backgroundSource?: "input_video" | "input_image"`
- `videoDuration?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `referenceOrder?: readonly string[]`
- `suppressedCanonicalCharacterIds?: readonly string[]`
- `suppressedCanonicalLocationIds?: readonly string[]`
- `videoPlayState?: "loop" | "paused" | "stopped"`
- `pausedAtTime?: number`

**Default data:**
```json
{
  "label": "Motion Transfer",
  "prompt": "",
  "characterOrientation": "video",
  "resolution": "720p",
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
**MCP tool:** `motion_transfer`

**Input parameters:**
- `image_url`
- `image_asset_id`
- `video_url`
- `video_asset_id`
- `prompt`
- `character_orientation`
- `resolution`
- `provider`
- `background_source`
- `video_duration`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "motion-transfer-1",
  "type": "motion-transfer",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Motion Transfer",
    "prompt": "",
    "characterOrientation": "video",
    "resolution": "720p",
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
