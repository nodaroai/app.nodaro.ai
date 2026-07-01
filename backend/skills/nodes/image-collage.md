---
node_type: image-collage
generated_at: 2026-07-01T15:39:01.234Z
generated_from: f20a5838e
---

# Image Collage

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `image-collage`
**Category:** processing
**Credit cost:** 2
**Inputs (target handles):** `in`
**Outputs (source handles):** `image`

**Required data fields:**
- `label: string`
- `layout: "smart" | "grid"`
- `resolution: "2K" | "4K"`
- `aspectRatio: string`
- `gap: number`
- `backgroundColor: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedImageUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`

**Default data:**
```json
{
  "label": "Image Collage",
  "layout": "smart",
  "resolution": "4K",
  "aspectRatio": "4:3",
  "gap": 24,
  "backgroundColor": "#ffffff",
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
  "id": "image-collage-1",
  "type": "image-collage",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Image Collage",
    "layout": "smart",
    "resolution": "4K",
    "aspectRatio": "4:3",
    "gap": 24,
    "backgroundColor": "#ffffff",
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
