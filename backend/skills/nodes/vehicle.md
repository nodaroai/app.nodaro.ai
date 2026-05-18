---
node_type: vehicle
generated_at: 2026-05-18T13:23:37.258Z
generated_from: cb1e786d
---

# Vehicle

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `vehicle`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `vehicle: string`

**Optional data fields:**
- `preText?: string`
- `postText?: string`

**Default data:**
```json
{
  "label": "Vehicle",
  "vehicle": "sedan"
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
  "id": "vehicle-1",
  "type": "vehicle",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Vehicle",
    "vehicle": "sedan"
  }
}
```
<!-- AUTO-GEN:END examples -->
