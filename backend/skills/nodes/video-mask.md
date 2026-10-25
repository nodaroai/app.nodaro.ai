---
node_type: video-mask
generated_at: 2026-10-25T16:39:13.640Z
generated_from: 906b8ede4
---

# Video Mask

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `video-mask`
**Category:** ai
**Credit cost:** `28-3108` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `video`, `prompt`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `prompt: string`
- `threshold: number`
- `provider: VideoMaskProvider`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `holdLastMask?: boolean`
- `minSubjectHeightPct?: number`
- `maxSubjectHeightPct?: number`
- `zone?: VideoMaskZone | null`
- `perShot?: boolean`
- `redetectEverySec?: number`
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
  "provider": "sam-3.1",
  "holdLastMask": false,
  "minSubjectHeightPct": 0,
  "maxSubjectHeightPct": 0,
  "zone": null,
  "perShot": false,
  "redetectEverySec": 0,
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
    "provider": "sam-3.1",
    "holdLastMask": false,
    "minSubjectHeightPct": 0,
    "maxSubjectHeightPct": 0,
    "zone": null,
    "perShot": false,
    "redetectEverySec": 0,
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
