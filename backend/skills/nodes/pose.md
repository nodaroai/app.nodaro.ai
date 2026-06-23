---
node_type: pose
generated_at: 2026-06-23T16:51:38.157Z
generated_from: 52fc7de9b
---

# Pose

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `pose`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `pose: string`

**Optional data fields:**
- `handPosition?: string`
- `bodyLean?: string`
- `headTilt?: string`
- `activity?: string`
- `preText?: string`
- `postText?: string`

**Valid values:** call `get_picker_catalog("pose")` (MCP) or `GET /v1/picker-catalogs/pose` for the catalog of valid ids.

**Default data:**
```json
{
  "label": "Pose",
  "pose": "standing-upright"
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
  "id": "pose-1",
  "type": "pose",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Pose",
    "pose": "standing-upright"
  }
}
```
<!-- AUTO-GEN:END examples -->
