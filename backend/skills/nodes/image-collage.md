---
node_type: image-collage
generated_at: 2026-08-29T19:04:28.729Z
generated_from: 1906376e1
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
- `imageSizeBySource?: Record<string, number>`
- `numbered?: boolean`
- `imageLabelBySource?: Record<string, string>`
- `badgePosition?: "top-left" | "top-right"`
- `imageOrder?: string[]`
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

Composite a batch of images into one 2K/4K sheet — contact sheets, mood boards, product grids, before/after comparisons. For a numbered **storyboard**, set `numbered: true` and give each input a label via `imageLabelBySource`: every image then gets a `1 · Wide` / `2 · Close-up` badge at its top-left (or top-right via `badgePosition`), counted in the collage's final reading order.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- Numbers follow the **final** reading order (after `imageOrder`), not the wire order — reorder the inputs to renumber.
- A List source's label repeats on every image it contributes, exactly like its size hint.
- Badges are drawn over the finished collage — they never change the layout, the output size, or the credit cost; both `numbered` and the labels are optional.

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
