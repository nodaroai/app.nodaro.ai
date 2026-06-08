---
node_type: generate-video
generated_at: 2026-06-08T19:29:01.651Z
generated_from: 6afbb8275
---

# Generate Video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `generate-video`
**Category:** ai
**Credit cost:** 20
**Inputs (target handles):** `startFrame`, `endFrame`, `audio`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `model: string`
- `duration: number`
- `fieldMappings: FieldMappings`
- `provider: VideoGenProvider`

**Optional data fields:**
- `motion?: "subtle" | "moderate" | "dynamic"`
- `motionEnabled?: boolean`
- `prompt?: string`
- `negativePrompt?: string`
- `generateAudio?: boolean`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `multiShot?: boolean`
- `resolution?: string`
- `grokMode?: "fun" | "normal" | "spicy"`
- `videoSize?: "standard" | "high"`
- `seed?: number`
- `cameraFixed?: boolean`
- `shots?: Array<{ prompt: string; duration: number }>`
- `elements?: Array<{ name: string; description: string; type: "image" | "video"; urls: string[] }>`
- `webSearch?: boolean`
- `nsfwChecker?: boolean`
- `videoTrimStart?: number`
- `videoTrimEnd?: number`
- `attachReferenceVideoVariant?: string`
- `loopTrim?: {
    enabled: boolean
    framesToTest?: number
    quality?: "lossless" | "precise"
  }`
- `enableTranslation?: boolean`
- `selectedStartFrameNodeId?: string`
- `selectedEndFrameNodeId?: string`
- `selectedAudioNodeId?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `kieTaskId?: string`
- `connectedImageOrder?: readonly string[]`
- `referenceOrder?: readonly string[]`
- `suppressedCanonicalCharacterIds?: readonly string[]`
- `suppressedCanonicalLocationIds?: readonly string[]`
- `veoMode?: "frame-to-frame" | "reference"`
- `extraRefs?: readonly ExtraRef[]`
- `videoPlayState?: "loop" | "paused" | "stopped"`
- `pausedAtTime?: number`
- `aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9" | "adaptive" | "Auto"`
- `referenceImageOrder?: readonly string[]`

**Default data:**
```json
{
  "label": "Generate Video",
  "provider": "seedance-2-fast",
  "duration": 5,
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
  "id": "generate-video-1",
  "type": "generate-video",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Generate Video",
    "provider": "seedance-2-fast",
    "duration": 5,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
