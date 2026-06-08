---
node_type: image-to-video
generated_at: 2026-06-08T19:29:01.634Z
generated_from: 6afbb8275
---

# image-to-video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `image-to-video`
**Category:** ai
**Credit cost:** 20
**Inputs (target handles):** `startFrame`, `endFrame`, `audio`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `provider: ImageToVideoProvider`
- `model: string`
- `duration: number`
- `fieldMappings: FieldMappings`

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
- `aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9" | "adaptive" | "Auto"`
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
- `connectedRefImageOrder?: readonly string[]`
- `referenceOrder?: readonly string[]`
- `suppressedCanonicalCharacterIds?: readonly string[]`
- `suppressedCanonicalLocationIds?: readonly string[]`
- `veoMode?: "frame-to-frame" | "reference"`
- `seedance2InputMode?: "frames" | "references"`
- `extraRefs?: readonly ExtraRef[]`
- `videoPlayState?: "loop" | "paused" | "stopped"`
- `pausedAtTime?: number`

**Default data:**
```json
{
  "label": "Image to Video",
  "provider": "seedance-2-fast",
  "duration": 5,
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `animate_image`

**Input parameters:**
- `prompt`
- `image_url`
- `image_asset_id`
- `model`
- `duration`
- `aspect_ratio`
- `resolution`
- `sound`
- `end_frame_url`
- `end_frame_asset_id`
- `reference_image_urls`
- `reference_video_urls`
- `reference_audio_urls`
- `seedance2_input_mode`
- `loop_trim`
- `auto_loop_trim`
<!-- AUTO-GEN:END mcp-call -->

## When to use

Animate a still image into a short video clip (5-15s typical). For multi-shot films, animate sequentially — each shot's end frame anchors the next shot's start frame.

## Common gotchas

- Field name is `generatedVideoUrl`, NOT `generatedImageUrl`. Using the image field name on a video node renders a blank placeholder.
- Seedance 2 (`seedance-2-fast`, `seedance-2`) always runs in multishot mode: pass `multishot: true`, `disable_internal_music: true`, `allow_sfx: true` to the MCP call.
- Veo / Veo 3.1 use fixed 8-second duration — the `duration` config field is ignored; the response is always 8s.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "image-to-video-1",
  "type": "image-to-video",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Image to Video",
    "provider": "seedance-2-fast",
    "duration": 5,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
