---
node_type: image-overlay
generated_at: 2026-09-08T11:55:24.467Z
generated_from: d346d3b2c
---

# Image Overlay

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `image-overlay`
**Category:** processing
**Credit cost:** 10
**Inputs (target handles):** `image`, `overlay`, `overlay2`, `overlay3`, `overlay4`, `overlay5`, `overlay6`, `overlay7`, `overlay8`, `overlay9`, `overlay10`, `overlay11`, `overlay12`, `qrText`
**Outputs (source handles):** `image`, `mask`

**Required data fields:**
- `label: string`
- `layers: OverlayLayerConfig[]`
- `outputFormat: "png" | "jpg" | "webp"`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `layerCount?: number`
- `canvas?: { width: number; height: number; backgroundColor: string }`
- `baseFit?: "contain" | "cover"`
- `platform?: string`
- `variants?: string[]`
- `overlayVariants?: Array<{ id: string; label: string; url: string; width: number; height: number }>`
- `maskMode?: "none" | "layers" | "around" | "outside"`
- `maskSpread?: number`
- `generatedMaskUrl?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedImageUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`

**Default data:**
```json
{
  "label": "Image Overlay",
  "layers": [
    {
      "anchor": "center",
      "x": 0,
      "y": 0,
      "width": 25,
      "opacity": 1,
      "rotation": 0,
      "blend": "over",
      "fit": "contain"
    }
  ],
  "layerCount": 4,
  "outputFormat": "png",
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
  "id": "image-overlay-1",
  "type": "image-overlay",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Image Overlay",
    "layers": [
      {
        "anchor": "center",
        "x": 0,
        "y": 0,
        "width": 25,
        "opacity": 1,
        "rotation": 0,
        "blend": "over",
        "fit": "contain"
      }
    ],
    "layerCount": 4,
    "outputFormat": "png",
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
