---
node_type: camera-motion
generated_at: 2026-05-18T13:23:37.116Z
generated_from: cb1e786d
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
