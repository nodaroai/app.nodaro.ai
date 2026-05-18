---
node_type: after-effects
generated_at: 2026-05-18T13:23:37.594Z
generated_from: cb1e786d
---

# After Effects

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `after-effects`
**Category:** processing
**Credit cost:** 2
**Inputs (target handles):** `in`
**Outputs (source handles):** `composition`

**Required data fields:**
- `label: string`
- `effectPrompt: string`
- `fps: number`
- `durationSeconds: number`

**Optional data fields:**
- `effectPlan?: Record<string, unknown>`
- `inputVideoUrl?: string`
- `width?: number`
- `height?: number`
- `llmModel?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `currentJobProgress?: number`
- `errorMessage?: string`

**Default data:**
```json
{
  "label": "After Effects",
  "effectPrompt": "",
  "fps": 30,
  "durationSeconds": 10,
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
  "id": "after-effects-1",
  "type": "after-effects",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "After Effects",
    "effectPrompt": "",
    "fps": 30,
    "durationSeconds": 10,
    "fieldMappings": {},
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
