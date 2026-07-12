---
node_type: combine-videos
generated_at: 2026-07-12T15:46:23.055Z
generated_from: 46865c972
---

# Combine Videos

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `combine-videos`
**Category:** processing
**Credit cost:** 2
**Inputs (target handles):** `in`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `transition: string`
- `transitionDuration: number`
- `audioMode: "keep" | "crossfade" | "remove"`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `audioCrossfadeCurve?: string`
- `audioCrossfadeDuration?: number`
- `smartCutEnabled?: boolean`
- `smartCutFramesPrev?: number`
- `smartCutFramesNext?: number`
- `trimStartFrames?: number`
- `trimEndFrames?: number`
- `clipOrder?: string[]`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Combine Videos",
  "transition": "cut",
  "transitionDuration": 0.5,
  "audioMode": "crossfade",
  "audioCrossfadeDuration": 0.5,
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `combine_videos`

**Input parameters:**
- `videos`
- `transition`
- `transition_duration`
- `audio_mode`
- `audio_crossfade_curve`
- `audio_crossfade_duration`
- `smart_cut`
- `smart_cut_frames_prev`
- `smart_cut_frames_next`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "combine-videos-1",
  "type": "combine-videos",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Combine Videos",
    "transition": "cut",
    "transitionDuration": 0.5,
    "audioMode": "crossfade",
    "audioCrossfadeDuration": 0.5,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
