---
node_type: combine-videos
generated_at: 2026-05-18T00:00:00Z
generated_from: hand-written
---

# combine-videos

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `combine-videos`
**Category:** processing
**Credit cost:** 0 (FFmpeg)
**Inputs (target handles):** `in` (accepts list of video URLs from upstream)
**Outputs (source handles):** `video`

**Required data fields (config):**
- `label: string`
- `transition: "cut" | "fade" | "dissolve" | "dip-to-black" | "dip-to-white"`
- `transitionDuration: number` — seconds (used only when `transition !== "cut"`)
- `audioMode: "keep" | "crossfade" | "remove"`
- `fieldMappings: Record<string, string>`

**Required result fields (when attaching a completed combine operation):**
- `executionStatus: "completed"`
- `generatedVideoUrl: string`

**Recommended result fields:**
- `generatedResults: [{ url, jobId, timestamp }]`
- `activeResultIndex: 0`

**Default data:**
```json
{ "label": "Combine Videos", "transition": "cut", "transitionDuration": 0.5, "audioMode": "crossfade", "fieldMappings": {} }
```
<!-- AUTO-GEN:END node-data-shape -->

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `combine_videos`

Pass an array of video URLs (typically from upstream trim or image-to-video nodes). Capture the response URL and write to `data.generatedVideoUrl`.
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
  "id": "stitch-1",
  "type": "combine-videos",
  "position": { "x": 1700, "y": 0 },
  "data": {
    "label": "Stitch Shots",
    "transition": "cut",
    "transitionDuration": 0.5,
    "audioMode": "crossfade",
    "fieldMappings": {},
    "executionStatus": "completed",
    "generatedVideoUrl": "https://r2.nodaro.ai/jobs/mno345/output.mp4"
  }
}
```
<!-- AUTO-GEN:END examples -->
