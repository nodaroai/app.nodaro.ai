---
node_type: composition-effects
generated_at: 2026-06-23T16:51:38.245Z
generated_from: 52fc7de9b
---

# Composition Effects

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `composition-effects`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `compositionEffect: string`

**Optional data fields:**
- `preText?: string`
- `postText?: string`

**Valid values:** call `get_picker_catalog("composition-effects")` (MCP) or `GET /v1/picker-catalogs/composition-effects` for the catalog of valid ids.

**Default data:**
```json
{
  "label": "Composition Effects",
  "compositionEffect": "bursting-through-frame"
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
  "id": "composition-effects-1",
  "type": "composition-effects",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Composition Effects",
    "compositionEffect": "bursting-through-frame"
  }
}
```
<!-- AUTO-GEN:END examples -->
