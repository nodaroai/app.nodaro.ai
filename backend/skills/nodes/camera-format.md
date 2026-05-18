---
node_type: camera-format
generated_at: 2026-05-18T13:23:37.132Z
generated_from: cb1e786d
---

# Camera / Film Stock

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `camera-format`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `cameraFormat: string`

**Optional data fields:**
- `preText?: string`
- `postText?: string`

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
