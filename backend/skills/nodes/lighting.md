---
node_type: lighting
generated_at: 2026-09-27T12:51:22.626Z
generated_from: c607aa02c
---

# Lighting

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `lighting`
**Category:** parameter
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `timeOfDay?: string`
- `lightingStyle?: string | ReadonlyArray<string>`
- `lightingDirection?: string`
- `lightingRatio?: string`
- `colorTemperature?: string`
- `maxItemsPerRow?: number`
- `preText?: string`
- `postText?: string`
- `hintMode?: "full" | "compact"`

**Valid values:** call `get_picker_catalog("lighting")` (MCP) or `GET /v1/picker-catalogs/lighting` for the catalog of valid ids.

**Default data:**
```json
{
  "label": "Lighting",
  "timeOfDay": "noon"
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
  "id": "lighting-1",
  "type": "lighting",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Lighting",
    "timeOfDay": "noon"
  }
}
```
<!-- AUTO-GEN:END examples -->
