---
node_type: render-video
generated_at: 2026-09-10T20:58:24.875Z
generated_from: 0b46d5d75
---

# Render Video

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `render-video`
**Category:** processing
**Credit cost:** 50
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

**A 3D scene render is priced by frame size, not by the node's Aspect Ratio.**
The frame comes from the scene plan's own `width` / `height`. Up to 1920 px on
the longest side it costs the base 50 credits whatever its shape (1920x1920
included); above that it is 75 credits up to 5.12 megapixels and 125 above
that, so a 2560x2560 scene costs 2.5x a 1920x1080 one. Every aspect the canvas
can author caps at 1920 px — only a plan written through the API, MCP or the
embed editor can reach the larger tiers. Read the live figure from the
model-cost API (`render-video`, `render-video:3d-large`,
`render-video:3d-xlarge`) rather than assuming the built-in default. Other
composition plans keep the flat price at any frame size.

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
