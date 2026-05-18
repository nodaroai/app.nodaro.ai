---
node_type: text-to-video
generated_at: 2026-05-18T20:51:28.609Z
generated_from: af4193bd
---

# Text to Video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `text-to-video`
**Category:** ai
**Credit cost:** 25
**Inputs (target handles):** `in`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `prompt: string`
- `provider: TextToVideoProvider`
- `duration: number`
- `aspectRatio: "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9" | "adaptive"`
- `negativePrompt: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `seed?: number`
- `enableTranslation?: boolean`
- `resolution?: string`
- `generateAudio?: boolean`
- `webSearch?: boolean`
- `nsfwChecker?: boolean`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `kieTaskId?: string`
- `connectedRefImageOrder?: readonly string[]`
- `referenceOrder?: readonly string[]`
- `suppressedCanonicalCharacterIds?: readonly string[]`
- `suppressedCanonicalLocationIds?: readonly string[]`
- `extraRefs?: readonly ExtraRef[]`
- `videoPlayState?: "loop" | "paused" | "stopped"`
- `pausedAtTime?: number`

**Default data:**
```json
{
  "label": "Text to Video",
  "prompt": "",
  "provider": "seedance-2-fast",
  "duration": 5,
  "aspectRatio": "16:9",
  "negativePrompt": "",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `generate_video`

**Input parameters:**
- `prompt`
- `model`
- `duration`
- `aspect_ratio`
- `resolution`
- `sound`
- `negative_prompt`
- `seed`
- `structured`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "text-to-video-1",
  "type": "text-to-video",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Text to Video",
    "prompt": "",
    "provider": "seedance-2-fast",
    "duration": 5,
    "aspectRatio": "16:9",
    "negativePrompt": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
