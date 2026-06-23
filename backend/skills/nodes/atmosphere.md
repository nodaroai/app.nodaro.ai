---
node_type: atmosphere
generated_at: 2026-06-23T16:51:38.054Z
generated_from: 52fc7de9b
---

# Atmosphere

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `atmosphere`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `atmosphere: string | ReadonlyArray<string> | undefined`

**Optional data fields:**
- `preText?: string`
- `postText?: string`

**Valid values:** call `get_picker_catalog("atmosphere")` (MCP) or `GET /v1/picker-catalogs/atmosphere` for the catalog of valid ids.

**Default data:**
```json
{
  "label": "Atmosphere",
  "atmosphere": "clear"
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
  "id": "atmosphere-1",
  "type": "atmosphere",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Atmosphere",
    "atmosphere": "clear"
  }
}
```
<!-- AUTO-GEN:END examples -->
