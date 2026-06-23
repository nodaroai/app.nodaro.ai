---
node_type: photo-genre
generated_at: 2026-06-23T16:51:38.205Z
generated_from: 52fc7de9b
---

# Photo Genre

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `photo-genre`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `photoGenre: string`

**Optional data fields:**
- `preText?: string`
- `postText?: string`

**Valid values:** call `get_picker_catalog("photo-genre")` (MCP) or `GET /v1/picker-catalogs/photo-genre` for the catalog of valid ids.

**Default data:**
```json
{
  "label": "Photo Genre",
  "photoGenre": "fashion-editorial"
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
  "id": "photo-genre-1",
  "type": "photo-genre",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Photo Genre",
    "photoGenre": "fashion-editorial"
  }
}
```
<!-- AUTO-GEN:END examples -->
