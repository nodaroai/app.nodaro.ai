---
node_type: temporal
generated_at: 2026-05-18T13:23:37.285Z
generated_from: cb1e786d
---

# Temporal

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `temporal`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `temporalSpeed?: string`
- `temporalFreeze?: string`
- `temporalDirection?: string`
- `temporalShutter?: string`
- `maxItemsPerRow?: number`
- `preText?: string`
- `postText?: string`

**Default data:**
```json
{
  "label": "Temporal",
  "temporalSpeed": "real-time"
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
  "id": "temporal-1",
  "type": "temporal",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Temporal",
    "temporalSpeed": "real-time"
  }
}
```
<!-- AUTO-GEN:END examples -->
