---
node_type: composite
generated_at: 2026-05-18T13:23:37.616Z
generated_from: cb1e786d
---

# Composite

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `composite`
**Category:** processing
**Credit cost:** 0
**Inputs (target handles):** `video1`, `video2`, `video3`, `video4`
**Outputs (source handles):** `composition`

**Required data fields:**
- `label: string`
- `layers: CompositeLayerConfig[]`
- `fps: number`
- `aspectRatio: "16:9" | "9:16" | "1:1" | "4:5"`
- `durationSeconds: number`
- `backgroundColor: string`

**Optional data fields:**
- `compositePlan?: Record<string, unknown>`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `currentJobProgress?: number`
- `errorMessage?: string`

**Default data:**
```json
{
  "label": "Composite",
  "layers": [],
  "fps": 30,
  "aspectRatio": "16:9",
  "durationSeconds": 10,
  "backgroundColor": "#000000",
  "executionStatus": "idle"
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
  "id": "composite-1",
  "type": "composite",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Composite",
    "layers": [],
    "fps": 30,
    "aspectRatio": "16:9",
    "durationSeconds": 10,
    "backgroundColor": "#000000",
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
