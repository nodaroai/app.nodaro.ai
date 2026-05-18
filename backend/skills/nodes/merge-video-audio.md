---
node_type: merge-video-audio
generated_at: 2026-05-18T13:23:37.525Z
generated_from: cb1e786d
---

# merge-video-audio

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `merge-video-audio`
**Category:** processing
**Credit cost:** 1
**Inputs (target handles):** `in`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `audioType: "voiceover" | "background" | "both"`
- `voiceoverVolume: number`
- `backgroundVolume: number`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `keepOriginalAudio?: boolean`
- `originalAudioVolume?: number`
- `originalAudioRole?: "background" | "effect" | "narration"`
- `trackSettings?: Record<string, { role: string; volume?: number; startTime?: number }>`
- `audioOffsets?: Record<string, number>`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Merge Video & Audio",
  "audioType": "voiceover",
  "voiceoverVolume": 100,
  "backgroundVolume": 30,
  "keepOriginalAudio": true,
  "originalAudioVolume": 30,
  "originalAudioRole": "background",
  "trackSettings": {},
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `merge_video_audio`

**Input parameters:**
- `video_url`
- `video_asset_id`
- `audio_url`
- `audio_asset_id`
- `audio_tracks`
- `voiceover_volume`
- `background_volume`
- `keep_original_audio`
<!-- AUTO-GEN:END mcp-call -->

## When to use

Stage 8 final step — marries the stitched video with the soundtrack from `generate-music`. Always the last node in a cinematic-flow workflow.

## Common gotchas

- When `keepOriginalAudio: true` and the upstream video has audio, that audio mixes with the new track per the volume settings. Setting `keepOriginalAudio: false` strips the original audio entirely before mixing.
- `audioType: "voiceover"` ducks the background track (drops `backgroundVolume`) under the voiceover. For a music-only mix, use `"background"` and set `voiceoverVolume: 0`.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "merge-video-audio-1",
  "type": "merge-video-audio",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Merge Video & Audio",
    "audioType": "voiceover",
    "voiceoverVolume": 100,
    "backgroundVolume": 30,
    "keepOriginalAudio": true,
    "originalAudioVolume": 30,
    "originalAudioRole": "background",
    "trackSettings": {},
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
