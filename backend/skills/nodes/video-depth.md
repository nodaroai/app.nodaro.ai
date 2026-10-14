---
node_type: video-depth
generated_at: 2026-10-14T00:02:36.947Z
generated_from: b83a9467d
---

# Video Depth

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `video-depth`
**Category:** processing
**Credit cost:** `33-6600` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `video`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `provider: VideoDepthProvider`
- `modelSize: VideoDepthModelSize`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `colormap?: VideoDepthColormap`
- `resolution?: VideoDepthResolution`
- `sideBySide?: boolean`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "Video Depth",
  "provider": "video-depth-anything",
  "modelSize": "large",
  "colormap": "grayscale",
  "resolution": "auto",
  "sideBySide": false,
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
**MCP tool:** `video_depth`

**Input parameters:**
- `video_url`
- `video_asset_id`
- `provider`
- `model_size`
- `colormap`
- `resolution`
- `side_by_side`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "video-depth-1",
  "type": "video-depth",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Video Depth",
    "provider": "video-depth-anything",
    "modelSize": "large",
    "colormap": "grayscale",
    "resolution": "auto",
    "sideBySide": false,
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
