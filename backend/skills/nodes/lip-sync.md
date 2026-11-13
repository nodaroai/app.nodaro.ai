---
node_type: lip-sync
generated_at: 2026-10-24T23:37:39.604Z
generated_from: db68a9ee4
---

# Lip Sync

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `lip-sync`
**Category:** ai
**Credit cost:** `143` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
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
- **`omnihuman-2-0`** — a different model from 1.5 (not its replacement): one still image driven by the voice, with an optional prompt (≤ 300 characters) for the scene, motion and camera; 720p, 4 s to 5 minutes. Long monologues and explainers. No resolution, seed or fast mode.
- **`latentsync`** — diffusion-based; best for singing or a strong vocal performance. Video input.
- **`heygen-lipsync-precision`** — dubs an existing clip with precise lip sync to a new audio track; billed per second. Video input.
- **`lipsync-2-pro`** — studio-grade dubbing of existing footage; billed per second. Video input.
- Wav2Lip, VideoReTalking and SadTalker are retired from Lip Sync: a call naming `wav2lip`, `video-retalking` or `sadtalker` is refused with a message to pick another model.
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
- `audio_duration_sec`
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
- `user_request`
- `flow_id`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- Input requirements by model: `seedance-2(-fast)`, `kling-avatar(-pro)`, `infinitalk`, `omnihuman-1-5`, `omnihuman-2-0` → image input only. `latentsync`, `heygen-lipsync-precision`, `lipsync-2-pro`, `sync-lipsync-v3`, `volcengine-lipsync` → video input only.
- Per-second providers (`kling-avatar(-pro)`, `volcengine-lipsync`, `omnihuman-1-5`) are priced by audio-duration bucket (15/30/60/120/300 s); the tool's `model` parameter states the current list price.
- `omnihuman-2-0` is charged per second of its audio — no buckets: the audio's length rounded up to a whole second, at least 4 s. The server downloads and decodes the audio to measure how long it plays (`audio_duration_sec` and the file's declared length are ignored). Audio under 4 s is padded with silence to 4 s (the avatar holds still for the rest); audio over 300 s, an audio file of 100 MB or more, a link that stalls, or an image outside 300–6,000 px a side / width ÷ height 0.4–2.5 / 30 MB is refused before anything is charged. Every audio file is converted to MP3 before it is sent (the model takes under 15 MB, held after conversion). A `lip_sync_audio_busy` refusal (429) means try again in a moment; `POST /v1/lip-sync` takes at most 30 `omnihuman-2-0` requests a minute per caller (429 `rate_limit_exceeded`); other models are not limited this way.

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
