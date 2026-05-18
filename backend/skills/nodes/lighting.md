---
node_type: lighting
generated_at: 2026-05-18T13:23:37.137Z
generated_from: cb1e786d
---

# Lighting

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `lighting`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `timeOfDay?: string`
- `lightingStyle?: string | ReadonlyArray<string>`
- `lightingDirection?: string`
- `lightingRatio?: string`
- `colorTemperature?: string`
- `maxItemsPerRow?: number`
- `preText?: string`
- `postText?: string`

**Default data:**
```json
{
  "label": "Lighting",
  "timeOfDay": "noon"
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
  "id": "lighting-1",
  "type": "lighting",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Lighting",
    "timeOfDay": "noon"
  }
}
```
<!-- AUTO-GEN:END examples -->
