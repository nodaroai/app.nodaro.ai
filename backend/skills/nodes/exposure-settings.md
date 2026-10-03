---
node_type: exposure-settings
generated_at: 2026-09-27T12:51:23.066Z
generated_from: c607aa02c
---

# Exposure Settings

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `exposure-settings`
**Category:** parameter
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `aperture?: string`
- `shutterSpeed?: string`
- `isoValue?: string`
- `maxItemsPerRow?: number`
- `preText?: string`
- `postText?: string`
- `hintMode?: "full" | "compact"`

**Valid values:** call `get_picker_catalog("exposure-settings")` (MCP) or `GET /v1/picker-catalogs/exposure-settings` for the catalog of valid ids.

**Default data:**
```json
{
  "label": "Exposure Settings",
  "aperture": "aperture-f1-4",
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
  "id": "exposure-settings-1",
  "type": "exposure-settings",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Exposure Settings",
    "aperture": "aperture-f1-4",
    "maxItemsPerRow": 2
  }
}
```
<!-- AUTO-GEN:END examples -->
