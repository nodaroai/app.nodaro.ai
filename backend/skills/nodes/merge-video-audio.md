---
node_type: merge-video-audio
generated_at: 2026-05-18T00:00:00Z
generated_from: hand-written
---

# merge-video-audio

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `merge-video-audio`
**Category:** processing
**Credit cost:** 0 (FFmpeg)
**Inputs (target handles):** `in` (video + audio routed via fieldMappings)
**Outputs (source handles):** `video`

**Required data fields (config):**
- `label: string`
- `audioType: "voiceover" | "background" | "both"`
- `voiceoverVolume: number` — 0-100
- `backgroundVolume: number` — 0-100
- `keepOriginalAudio: boolean`
- `originalAudioVolume: number` — 0-100
- `originalAudioRole: "background" | "effect" | "narration"`
- `trackSettings: Record<string, unknown>`
- `fieldMappings: Record<string, string>`

**Required result fields (when attaching a completed merge operation):**
- `executionStatus: "completed"`
- `generatedVideoUrl: string`

**Recommended result fields:**
- `generatedResults: [{ url, jobId, timestamp }]`
- `activeResultIndex: 0`

**Default data:**
```json
{ "label": "Merge Video & Audio", "audioType": "voiceover", "voiceoverVolume": 100, "backgroundVolume": 30, "keepOriginalAudio": true, "originalAudioVolume": 30, "originalAudioRole": "background", "trackSettings": {}, "fieldMappings": {} }
```
<!-- AUTO-GEN:END node-data-shape -->

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `merge_video_audio`

Pass the combined video URL + the music track URL. Capture the response URL and write to `data.generatedVideoUrl`.
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
  "id": "final-1",
  "type": "merge-video-audio",
  "position": { "x": 2040, "y": 0 },
  "data": {
    "label": "Final Mix",
    "audioType": "background",
    "voiceoverVolume": 0,
    "backgroundVolume": 80,
    "keepOriginalAudio": false,
    "originalAudioVolume": 0,
    "originalAudioRole": "background",
    "trackSettings": {},
    "fieldMappings": {},
    "executionStatus": "completed",
    "generatedVideoUrl": "https://r2.nodaro.ai/jobs/pqr678/output.mp4"
  }
}
```
<!-- AUTO-GEN:END examples -->
