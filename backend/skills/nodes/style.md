---
node_type: style
generated_at: 2026-09-27T12:51:22.693Z
generated_from: c607aa02c
---

# Style

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `style`
**Category:** parameter
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `style: string`

**Optional data fields:**
- `preText?: string`
- `postText?: string`
- `hintMode?: "full" | "compact"`

**Valid values:** call `get_picker_catalog("style")` (MCP) or `GET /v1/picker-catalogs/style` for the catalog of valid ids.

**Default data:**
```json
{
  "label": "Style",
  "style": "cinematic"
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
  "id": "style-1",
  "type": "style",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Style",
    "style": "cinematic"
  }
}
```
<!-- AUTO-GEN:END examples -->
