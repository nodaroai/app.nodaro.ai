---
node_type: video-upscale
generated_at: 2026-10-14T00:02:36.881Z
generated_from: b83a9467d
---

# Upscale Video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `video-upscale`
**Category:** processing
**Credit cost:** `165` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `video`
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
- `task_id`
- `source_job_id`
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
