---
node_type: render-video
generated_at: 2026-05-18T13:23:37.623Z
generated_from: cb1e786d
---

# Render Video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `render-video`
**Category:** processing
**Credit cost:** 3
**Inputs (target handles):** `in`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `fps: number`
- `aspectRatio: "16:9" | "9:16" | "1:1" | "4:5"`
- `durationSeconds: number`
- `backgroundColor: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `assetOrder?: string[]`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "Render Video",
  "fps": 30,
  "aspectRatio": "16:9",
  "durationSeconds": 30,
  "backgroundColor": "#000000",
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
  "id": "render-video-1",
  "type": "render-video",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Render Video",
    "fps": 30,
    "aspectRatio": "16:9",
    "durationSeconds": 30,
    "backgroundColor": "#000000",
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
