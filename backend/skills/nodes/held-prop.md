---
node_type: held-prop
generated_at: 2026-06-23T16:51:38.218Z
generated_from: 52fc7de9b
---

# Held Prop

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `held-prop`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `heldProp: string | ReadonlyArray<string> | undefined`

**Optional data fields:**
- `preText?: string`
- `postText?: string`

**Valid values:** call `get_picker_catalog("held-prop")` (MCP) or `GET /v1/picker-catalogs/held-prop` for the catalog of valid ids.

**Default data:**
```json
{
  "label": "Held Prop",
  "heldProp": "smartphone"
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
  "id": "held-prop-1",
  "type": "held-prop",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Held Prop",
    "heldProp": "smartphone"
  }
}
```
<!-- AUTO-GEN:END examples -->
