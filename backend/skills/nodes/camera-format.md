---
node_type: camera-format
generated_at: 2026-06-23T16:51:38.034Z
generated_from: 52fc7de9b
---

# Camera / Film Stock

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `camera-format`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`, `picker-json`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `cameraFormat: string`

**Optional data fields:**
- `preText?: string`
- `postText?: string`

**Valid values:** call `get_picker_catalog("camera-format")` (MCP) or `GET /v1/picker-catalogs/camera-format` for the catalog of valid ids.

**Default data:**
```json
{
  "label": "Camera / Film Stock",
  "cameraFormat": "35mm-film"
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
  "id": "camera-format-1",
  "type": "camera-format",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Camera / Film Stock",
    "cameraFormat": "35mm-film"
  }
}
```
<!-- AUTO-GEN:END examples -->
