---
node_type: camera-motion
generated_at: 2026-06-23T16:51:37.998Z
generated_from: 52fc7de9b
---

# Camera Motion

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `camera-motion`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `cameraMotion: string`

**Optional data fields:**
- `preText?: string`
- `postText?: string`

**Valid values:** call `get_picker_catalog("camera-motion")` (MCP) or `GET /v1/picker-catalogs/camera-motion` for the catalog of valid ids.

**Default data:**
```json
{
  "label": "Camera Motion",
  "cameraMotion": "static"
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
  "id": "camera-motion-1",
  "type": "camera-motion",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Camera Motion",
    "cameraMotion": "static"
  }
}
```
<!-- AUTO-GEN:END examples -->
