---
node_type: trim-video
generated_at: 2026-05-18T00:00:00Z
generated_from: hand-written
---

# trim-video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `trim-video`
**Category:** processing
**Credit cost:** 0 (FFmpeg)
**Inputs (target handles):** `in`
**Outputs (source handles):** `video`

**Required data fields (config):**
- `label: string`
- `startTime: number` — seconds from the start of the input video
- `endTime: number` — seconds from the start of the input video
- `fieldMappings: Record<string, string>`

**Required result fields (when attaching a completed trim operation):**
- `executionStatus: "completed"`
- `generatedVideoUrl: string`

**Recommended result fields:**
- `generatedResults: [{ url, jobId, timestamp }]`
- `activeResultIndex: 0`

**Default data:**
```json
{ "label": "Trim Video", "startTime": 0, "endTime": 0, "fieldMappings": {} }
```
<!-- AUTO-GEN:END node-data-shape -->

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `trim_video`

Pass the source video URL plus `startTime` + `endTime`. Capture the response URL and write to `data.generatedVideoUrl`.
<!-- AUTO-GEN:END mcp-call -->

## When to use

Cut a video clip to a precise time range. Common uses: shortening an animation to a specific in/out point before stitching, removing a slow opening from a generated clip, isolating a specific beat.

## Common gotchas

- If you attach a `trim-video` node WITHOUT executing the underlying trim (just declaring parameters for the user to run later), omit the result fields entirely and leave `executionStatus` unset — the node defaults to `"idle"` and shows its configuration.
- `endTime - startTime` must be positive. Negative or zero spans are rejected by the FFmpeg worker. The default `endTime: 0` is intentional — you must set a real value before running.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "trim-1",
  "type": "trim-video",
  "position": { "x": 1360, "y": 0 },
  "data": {
    "label": "Shot 1 — Trim",
    "startTime": 0,
    "endTime": 2.5,
    "fieldMappings": {},
    "executionStatus": "completed",
    "generatedVideoUrl": "https://r2.nodaro.ai/jobs/jkl012/output.mp4"
  }
}
```
<!-- AUTO-GEN:END examples -->
