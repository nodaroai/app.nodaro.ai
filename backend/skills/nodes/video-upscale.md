---
node_type: video-upscale
generated_at: 2026-05-18T13:23:37.682Z
generated_from: cb1e786d
---

# Upscale Video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `video-upscale`
**Category:** processing
**Credit cost:** 15
**Inputs (target handles):** `in`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `provider: VideoUpscaleProvider`
- `upscaleFactor: "1" | "2" | "4"`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `kieTaskId?: string`

**Default data:**
```json
{
  "label": "Upscale Video",
  "provider": "topaz",
  "upscaleFactor": "2",
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
**MCP tool:** `video_upscale`

**Input parameters:**
- `video_url`
- `video_asset_id`
- `model`
- `upscale_factor`
- `kie_task_id`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "video-upscale-1",
  "type": "video-upscale",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Upscale Video",
    "provider": "topaz",
    "upscaleFactor": "2",
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
