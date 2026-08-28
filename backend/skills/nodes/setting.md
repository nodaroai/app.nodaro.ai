---
node_type: setting
generated_at: 2026-08-28T10:30:57.434Z
generated_from: ae8d76277
---

# Setting

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `setting`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `setting: string`

**Optional data fields:**
- `preText?: string`
- `postText?: string`
- `hintMode?: "full" | "compact"`

**Valid values:** call `get_picker_catalog("setting")` (MCP) or `GET /v1/picker-catalogs/setting` for the catalog of valid ids.

**Default data:**
```json
{
  "label": "Setting",
  "setting": "forest"
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
  "id": "setting-1",
  "type": "setting",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Setting",
    "setting": "forest"
  }
}
```
<!-- AUTO-GEN:END examples -->
