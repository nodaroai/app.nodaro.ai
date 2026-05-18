---
node_type: motion-graphics
generated_at: 2026-05-18T13:23:37.611Z
generated_from: cb1e786d
---

# Motion Graphics

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `motion-graphics`
**Category:** ai
**Credit cost:** 2
**Inputs (target handles):** `in`
**Outputs (source handles):** `composition`

**Required data fields:**
- `label: string`
- `motionPrompt: string`
- `aspectRatio: "16:9" | "9:16" | "1:1" | "4:5"`
- `backgroundColor: string`
- `fps: number`
- `durationSeconds: number`

**Optional data fields:**
- `motionPlan?: Record<string, unknown>`
- `llmModel?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `currentJobProgress?: number`
- `errorMessage?: string`

**Default data:**
```json
{
  "label": "Motion Graphics",
  "motionPrompt": "",
  "aspectRatio": "16:9",
  "backgroundColor": "#00000000",
  "fps": 30,
  "durationSeconds": 5,
  "fieldMappings": {},
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
  "id": "motion-graphics-1",
  "type": "motion-graphics",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Motion Graphics",
    "motionPrompt": "",
    "aspectRatio": "16:9",
    "backgroundColor": "#00000000",
    "fps": 30,
    "durationSeconds": 5,
    "fieldMappings": {},
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
