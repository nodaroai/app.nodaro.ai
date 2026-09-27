---
node_type: extract-frame
generated_at: 2026-09-27T12:51:24.301Z
generated_from: c607aa02c
---

# Extract Frame

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `extract-frame`
**Category:** processing
**Credit cost:** `10` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `in`
**Outputs (source handles):** `image`

**Required data fields:**
- `label: string`
- `mode: "first" | "last" | "timestamp" | "frame-index" | "frame-from-end" | "keyframe"`
- `timestamp: number`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `frameIndex?: number`
- `framesFromEnd?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedImageUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "Extract Frame",
  "mode": "first",
  "timestamp": 0,
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
**MCP tool:** `extract_frame`

**Input parameters:**
- `video_url`
- `video_asset_id`
- `mode`
- `time_seconds`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "extract-frame-1",
  "type": "extract-frame",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Extract Frame",
    "mode": "first",
    "timestamp": 0,
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
