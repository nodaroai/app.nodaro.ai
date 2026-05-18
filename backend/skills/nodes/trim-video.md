---
node_type: trim-video
generated_at: 2026-05-18T13:23:37.575Z
generated_from: cb1e786d
---

# trim-video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `trim-video`
**Category:** processing
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `startTime: number`
- `endTime: number`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `trimMode?: "time" | "frames" | "smart-loop-cut"`
- `trimStartFrames?: number`
- `trimEndFrames?: number`
- `smartLoopCutLookback?: number`
- `outputSilentVideo?: boolean`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Trim Video",
  "startTime": 0,
  "endTime": 0,
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `trim_video`

**Input parameters:**
- `video_url`
- `video_asset_id`
- `start_time`
- `end_time`
- `trim_start_frames`
- `trim_end_frames`
- `smart_loop_cut`
- `smart_loop_cut_lookback`
- `silent`
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
  "id": "trim-video-1",
  "type": "trim-video",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Trim Video",
    "startTime": 0,
    "endTime": 0,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
