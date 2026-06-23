---
node_type: era
generated_at: 2026-06-23T16:51:38.151Z
generated_from: 52fc7de9b
---

# Era / Period

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `era`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `era: string`

**Optional data fields:**
- `preText?: string`
- `postText?: string`

**Valid values:** call `get_picker_catalog("era")` (MCP) or `GET /v1/picker-catalogs/era` for the catalog of valid ids.

**Default data:**
```json
{
  "label": "Era",
  "era": "1990s-mall"
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
  "id": "era-1",
  "type": "era",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Era",
    "era": "1990s-mall"
  }
}
```
<!-- AUTO-GEN:END examples -->
