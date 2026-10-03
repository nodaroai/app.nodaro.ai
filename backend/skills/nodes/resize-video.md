---
node_type: resize-video
generated_at: 2026-09-27T12:51:24.061Z
generated_from: c607aa02c
---

# Resize Video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `resize-video`
**Category:** processing
**Credit cost:** `20` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `in`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `targetAspect: "1:1" | "16:9" | "9:16" | "4:5"`
- `method: "crop" | "pad" | "stretch"`
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
  "label": "Resize Video",
  "targetAspect": "9:16",
  "method": "crop",
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
  "id": "resize-video-1",
  "type": "resize-video",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Resize Video",
    "targetAspect": "9:16",
    "method": "crop",
    "padColor": "#000000",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
