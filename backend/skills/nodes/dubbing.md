---
node_type: dubbing
generated_at: 2026-08-30T23:28:29.053Z
generated_from: 5be082c3f
---

# Dubbing

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `dubbing`
**Category:** ai
**Credit cost:** 40
**Inputs (target handles):** `audio`, `video`
**Outputs (source handles):** `audio`, `video`

**Required data fields:**
- `label: string`
- `targetLanguage: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `sourceLanguage?: string`
- `numSpeakers?: number`
- `disableVoiceCloning?: boolean`
- `dropBackgroundAudio?: boolean`
- `sourceUrl?: string`
- `startTime?: number`
- `endTime?: number`
- `highestResolution?: boolean`
- `useProfanityFilter?: boolean`
- `targetAccent?: string`
- `watermark?: boolean`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedAudioUrl?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "Dubbing",
  "targetLanguage": "es",
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
**MCP tool:** `dubbing`

**Input parameters:**
- `audio_url`
- `audio_asset_id`
- `video_url`
- `video_asset_id`
- `source_url`
- `target_language`
- `source_language`
- `num_speakers`
- `disable_voice_cloning`
- `drop_background_audio`
- `start_time`
- `end_time`
- `highest_resolution`
- `use_profanity_filter`
- `target_accent`
- `watermark`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "dubbing-1",
  "type": "dubbing",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Dubbing",
    "targetLanguage": "es",
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
