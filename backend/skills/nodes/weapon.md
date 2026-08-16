---
node_type: weapon
generated_at: 2026-08-15T21:55:06.227Z
generated_from: 150c80ac9
---

# Weapon

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `weapon`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `weapon: string`

**Optional data fields:**
- `preText?: string`
- `postText?: string`

**Valid values:** call `get_picker_catalog("weapon")` (MCP) or `GET /v1/picker-catalogs/weapon` for the catalog of valid ids.

**Default data:**
```json
{
  "label": "Weapon",
  "weapon": "katana"
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
  "id": "weapon-1",
  "type": "weapon",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Weapon",
    "weapon": "katana"
  }
}
```
<!-- AUTO-GEN:END examples -->
