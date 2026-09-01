---
node_type: styling
generated_at: 2026-09-01T14:41:53.694Z
generated_from: 36ffac616
---

# Styling

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `styling`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`, `picker-json`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `makeup?: string`
- `eyewear?: string`
- `headwear?: string | ReadonlyArray<string>`
- `hairCut?: string`
- `hairTreatment?: string`
- `hairState?: string | ReadonlyArray<string>`
- `jewelry?: string | ReadonlyArray<string>`
- `nails?: string`
- `facePaint?: string`
- `outfit?: string`
- `top?: string`
- `bottom?: string`
- `outerwear?: string`
- `legwear?: string`
- `footwear?: string`
- `fabric?: string`
- `wardrobeState?: string | ReadonlyArray<string>`
- `preText?: string`
- `postText?: string`
- `maxItemsPerRow?: number`
- `applyMode?: PickerApplyMode`
- `autoApplyInjected?: boolean`
- `lastAppliedPickerJson?: Record<string, unknown>`
- `hintMode?: "full" | "compact"`

**Valid values:** call `get_picker_catalog("styling")` (MCP) or `GET /v1/picker-catalogs/styling` for the catalog of valid ids.

**Default data:**
```json
{
  "label": "Styling",
  "makeup": "makeup-natural",
  "maxItemsPerRow": 2
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
  "id": "styling-1",
  "type": "styling",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Styling",
    "makeup": "makeup-natural",
    "maxItemsPerRow": 2
  }
}
```
<!-- AUTO-GEN:END examples -->
