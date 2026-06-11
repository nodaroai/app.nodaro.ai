---
node_type: speech-to-video
generated_at: 2026-06-11T18:52:25.288Z
generated_from: 36d155ff
---

# Speech to Video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `speech-to-video`
**Category:** ai
**Credit cost:** 4
**Inputs (target handles):** `image`, `audio`, `prompt`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `prompt: string`
- `resolution: "480p" | "580p" | "720p"`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `negativePrompt?: string`
- `seed?: number`
- `numFrames?: number`
- `fps?: number`
- `inferenceSteps?: number`
- `guidanceScale?: number`
- `shift?: number`
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
  "label": "Speech to Video",
  "prompt": "A person speaking naturally",
  "negativePrompt": "",
  "resolution": "480p",
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
**MCP tool:** `speech_to_video`

**Input parameters:**
- `image_url`
- `image_asset_id`
- `audio_url`
- `audio_asset_id`
- `prompt`
- `resolution`
- `negative_prompt`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "speech-to-video-1",
  "type": "speech-to-video",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Speech to Video",
    "prompt": "A person speaking naturally",
    "negativePrompt": "",
    "resolution": "480p",
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
