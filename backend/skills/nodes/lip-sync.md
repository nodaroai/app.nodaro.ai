---
node_type: lip-sync
generated_at: 2026-06-25T00:52:39.876Z
generated_from: e70d38e91
---

# Lip Sync

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `lip-sync`
**Category:** ai
**Credit cost:** 40
**Inputs (target handles):** `image`, `video`, `audio`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `provider: LipSyncProvider`
- `resolution: "480p" | "720p" | "1080p"`
- `prompt: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `currentJobProgress?: number`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `selectedImageNodeId?: string`
- `selectedVideoNodeId?: string`
- `selectedAudioNodeId?: string`
- `audioDurationSec?: number`
- `guidanceScale?: number`
- `inferenceSteps?: number`
- `seed?: number`
- `fastMode?: boolean`
- `pads?: string`
- `smooth?: boolean`
- `fps?: number`
- `resizeFactor?: number`
- `enhancer?: "gfpgan" | "RestoreFormer"`
- `preprocess?: "crop" | "resize" | "full"`
- `still?: boolean`
- `poseStyle?: number`
- `expressionScale?: number`
- `enableDynamicDuration?: boolean`
- `disableMusicTrack?: boolean`
- `enableSpeechEnhancement?: boolean`
- `syncMode?: "loop" | "bounce" | "cut_off" | "silence" | "remap"`
- `temperature?: number`
- `activeSpeaker?: boolean`
- `mode?: "lite" | "basic"`
- `separateVocal?: boolean`
- `openScenedet?: boolean`
- `alignAudio?: boolean`
- `alignAudioReverse?: boolean`
- `templStartSeconds?: number`
- `referenceOrder?: readonly string[]`
- `suppressedCanonicalCharacterIds?: readonly string[]`
- `suppressedCanonicalLocationIds?: readonly string[]`
- `videoPlayState?: "loop" | "paused" | "stopped"`
- `pausedAtTime?: number`

**Default data:**
```json
{
  "label": "Lip Sync",
  "provider": "kling-avatar",
  "resolution": "720p",
  "prompt": "",
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
**MCP tool:** `lip_sync`

**Input parameters:**
- `image_url`
- `image_asset_id`
- `video_url`
- `video_asset_id`
- `audio_url`
- `audio_asset_id`
- `prompt`
- `model`
- `resolution`
- `seed`
- `fast_mode`
- `mode`
- `separate_vocal`
- `open_scenedet`
- `align_audio`
- `align_audio_reverse`
- `templ_start_seconds`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "lip-sync-1",
  "type": "lip-sync",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Lip Sync",
    "provider": "kling-avatar",
    "resolution": "720p",
    "prompt": "",
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
