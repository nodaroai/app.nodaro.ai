---
node_type: lip-sync
generated_at: 2026-08-29T19:02:39.224Z
generated_from: 7dbf4818b
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
- `promptPrefix?: string`
- `promptSuffix?: string`
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

Make a face talk to an audio track (`lip_sync` over MCP): lip-sync, talking heads, dubbing onto a character. ONE face source (an image, or a video whose mouth gets re-driven) and ONE audio source.

### Picking a model (quality first, cost as tiebreaker — credits are on the tool's `model` parameter and in `list_models`)

- **`seedance-2`** — ByteDance multimodal video model with native phoneme-level lip sync in 8+ languages; cinematic full-body output, strong identity preservation, premium. Hero scenes, multi-language dubs, best quality.
- **`seedance-2-fast`** — the same Seedance 2 phoneme lip sync, cheaper and faster (480p/720p only).
- **`kling-avatar`** (default) — KIE talking head, 720p, speech-optimized; the best cost/quality balance for plain talking-head shots.
- **`kling-avatar-pro`** — KIE premium talking head, 1080p; sharper mouth sync and micro-expressions.
- **`infinitalk`** — KIE flexible resolution via the `resolution` parameter; the cheapest KIE option at 480p.
- **`omnihuman-1-5`** — prompt-directed performance, 720p/1080p, premium.
- **`latentsync`** — diffusion-based; best for singing or a strong vocal performance. Video input.
- **`wav2lip`** — fastest and cheapest; image OR video. Quick drafts and many iterations.
- **`video-retalking`** — built-in face enhancement, clean output. Video input; good when the source face is small or blurry.
- **`sadtalker`** — talking avatar from a SINGLE image, when no video exists.
- **`volcengine-lipsync`** — KIE video-to-video AI dubbing: re-syncs an existing clip's lips to a new vocal track; `mode: basic` + `open_scenedet: true` for multi-speaker. The cheapest modern dubbing option. Video input.

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

- Input requirements by model: `seedance-2(-fast)`, `kling-avatar(-pro)`, `infinitalk`, `sadtalker`, `omnihuman-1-5` → image input only. `latentsync`, `video-retalking`, `volcengine-lipsync` → video input only. `wav2lip` → image OR video.
- Per-second providers (`kling-avatar(-pro)`, `volcengine-lipsync`, `omnihuman-1-5`) are priced by audio-duration bucket (15/30/60/120/300 s); the tool's `model` parameter states the current list price.

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
