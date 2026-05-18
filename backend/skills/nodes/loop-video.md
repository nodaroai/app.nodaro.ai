---
node_type: loop-video
generated_at: 2026-05-18T13:23:37.633Z
generated_from: cb1e786d
---

# Loop Video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `loop-video`
**Category:** processing
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `mode: "repeat" | "duration"`
- `repeatCount: number`
- `targetDuration: number`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `smartLoopCutBeforeRepeat?: boolean`
- `smartLoopCutLookback?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Loop Video",
  "mode": "repeat",
  "repeatCount": 2,
  "targetDuration": 10,
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `loop_video`

**Input parameters:**
- `video_url`
- `video_asset_id`
- `mode`
- `repeat_count`
- `target_duration`
- `smart_cut_before_repeat`
- `smart_cut_lookback`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "loop-video-1",
  "type": "loop-video",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Loop Video",
    "mode": "repeat",
    "repeatCount": 2,
    "targetDuration": 10,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
