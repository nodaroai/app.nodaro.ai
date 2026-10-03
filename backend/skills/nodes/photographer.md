---
node_type: photographer
generated_at: 2026-09-27T12:51:22.846Z
generated_from: c607aa02c
---

# Photographer / Artist Style

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `photographer`
**Category:** parameter
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `photographer: string | ReadonlyArray<string> | undefined`

**Optional data fields:**
- `preText?: string`
- `postText?: string`
- `hintMode?: "full" | "compact"`

**Valid values:** call `get_picker_catalog("photographer")` (MCP) or `GET /v1/picker-catalogs/photographer` for the catalog of valid ids.

**Default data:**
```json
{
  "label": "Photographer",
  "photographer": "tim-walker"
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
  "id": "photographer-1",
  "type": "photographer",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Photographer",
    "photographer": "tim-walker"
  }
}
```
<!-- AUTO-GEN:END examples -->
