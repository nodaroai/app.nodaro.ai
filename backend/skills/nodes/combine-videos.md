---
node_type: combine-videos
generated_at: 2026-05-20T12:52:11.311Z
generated_from: aef31e47
---

# combine-videos

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
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `combine_videos`

**Input parameters:**
- `videos`
- `transition`
- `transition_duration`
- `audio_mode`
<!-- AUTO-GEN:END mcp-call -->

## When to use

Stitch multiple video clips into a single output. For multi-shot films, this runs after per-shot trimming in Stage 8 (final assembly).

## Common gotchas

- The backend probes every input clip's resolution and unifies them (letterboxes smaller clips to the most common dimensions). You don't need to resize manually before combining.
- `crossfade` audio mode requires source clips to have audio tracks. If any clip is silent, it falls back to a hard cut on the audio.
- `dip-to-black` / `dip-to-white` insert short color frames between clips — useful for emotional cuts.

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
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
