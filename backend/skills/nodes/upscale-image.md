---
node_type: upscale-image
generated_at: 2026-05-18T13:23:37.333Z
generated_from: cb1e786d
---

# Upscale Image

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `upscale-image`
**Category:** ai
**Credit cost:** 1
**Inputs (target handles):** `image`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `provider: UpscaleImageProvider`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `upscaleFactor?: string`
- `targetResolution?: "2K" | "4K" | "8K"`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedImageUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "Upscale Image",
  "provider": "recraft-upscale",
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
  "id": "upscale-image-1",
  "type": "upscale-image",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Upscale Image",
    "provider": "recraft-upscale",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
