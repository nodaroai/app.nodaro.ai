---
node_type: furniture
generated_at: 2026-06-23T16:51:38.197Z
generated_from: 52fc7de9b
---

# Furniture

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `furniture`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `furniture: string`

**Optional data fields:**
- `preText?: string`
- `postText?: string`

**Valid values:** call `get_picker_catalog("furniture")` (MCP) or `GET /v1/picker-catalogs/furniture` for the catalog of valid ids.

**Default data:**
```json
{
  "label": "Furniture",
  "furniture": "sofa"
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
  "id": "furniture-1",
  "type": "furniture",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Furniture",
    "furniture": "sofa"
  }
}
```
<!-- AUTO-GEN:END examples -->
