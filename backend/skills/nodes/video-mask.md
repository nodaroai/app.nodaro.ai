---
node_type: video-mask
generated_at: 2026-10-11T22:04:02.090Z
generated_from: 3b192eb31
---

# Video Mask

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `video-mask`
**Category:** ai
**Credit cost:** `25-283` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `video`, `prompt`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `prompt: string`
- `threshold: number`
- `provider: VideoMaskProvider`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `videoUrl?: string`
- `activeResultIndex?: number`
- `generatedResults?: GeneratedResult[]`
- `generatedVideoUrl?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `promptPrefix?: string`
- `promptSuffix?: string`

**Default data:**
```json
{
  "label": "Video Mask",
  "prompt": "",
  "threshold": 0.5,
  "provider": "sam-3",
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
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "video-mask-1",
  "type": "video-mask",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Video Mask",
    "prompt": "",
    "threshold": 0.5,
    "provider": "sam-3",
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
