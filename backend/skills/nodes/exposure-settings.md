---
node_type: exposure-settings
generated_at: 2026-05-18T13:23:37.290Z
generated_from: cb1e786d
---

# Exposure Settings

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `exposure-settings`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `aperture?: string`
- `shutterSpeed?: string`
- `isoValue?: string`
- `maxItemsPerRow?: number`
- `preText?: string`
- `postText?: string`

**Default data:**
```json
{
  "label": "Exposure Settings",
  "aperture": "aperture-f1-4",
  "maxItemsPerRow": 2
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
  "id": "exposure-settings-1",
  "type": "exposure-settings",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Exposure Settings",
    "aperture": "aperture-f1-4",
    "maxItemsPerRow": 2
  }
}
```
<!-- AUTO-GEN:END examples -->
