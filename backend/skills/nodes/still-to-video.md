---
node_type: still-to-video
generated_at: 2026-09-27T12:51:24.013Z
generated_from: c607aa02c
---

# Still to Video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `still-to-video`
**Category:** processing
**Credit cost:** `0` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `image`, `audio`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `motion: "none" | "zoom-in" | "zoom-out" | "pan-left" | "pan-right" | "ken-burns"`
- `intensity: number`
- `resolution: "720p" | "1080p" | "4K"`
- `aspectRatio: "16:9" | "9:16" | "1:1" | "4:3"`
- `fps: 24 | 30`
- `fit: "cover" | "contain"`
- `padColor: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Still to Video",
  "motion": "none",
  "intensity": 3,
  "resolution": "1080p",
  "aspectRatio": "16:9",
  "fps": 30,
  "fit": "cover",
  "padColor": "#000000",
  "fieldMappings": {}
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
  "id": "still-to-video-1",
  "type": "still-to-video",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Still to Video",
    "motion": "none",
    "intensity": 3,
    "resolution": "1080p",
    "aspectRatio": "16:9",
    "fps": 30,
    "fit": "cover",
    "padColor": "#000000",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
