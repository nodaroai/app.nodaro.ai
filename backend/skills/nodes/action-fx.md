---
node_type: action-fx
generated_at: 2026-06-23T16:51:38.062Z
generated_from: 52fc7de9b
---

# Action FX

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `action-fx`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `actionFx: string | ReadonlyArray<string> | undefined`

**Optional data fields:**
- `preText?: string`
- `postText?: string`

**Valid values:** call `get_picker_catalog("action-fx")` (MCP) or `GET /v1/picker-catalogs/action-fx` for the catalog of valid ids.

**Default data:**
```json
{
  "label": "Action FX"
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
  "id": "action-fx-1",
  "type": "action-fx",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Action FX"
  }
}
```
<!-- AUTO-GEN:END examples -->
