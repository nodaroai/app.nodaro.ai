---
node_type: 3d-title
generated_at: 2026-07-13T16:15:38.149Z
generated_from: 9af14ef89
---

# 3D Title

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `3d-title`
**Category:** ai
**Credit cost:** 3
**Inputs (target handles):** `background`
**Outputs (source handles):** `composition`

**Required data fields:**
- `label: string`
- `titlePrompt: string`
- `aspectRatio: "16:9" | "9:16" | "1:1" | "4:5"`
- `backgroundColor: string`
- `fps: number`
- `durationSeconds: number`

**Optional data fields:**
- `titlePlan?: Record<string, unknown>`
- `backgroundMediaUrl?: string`
- `llmModel?: string`
- `reasoningEffort?: LlmReasoningEffort`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `currentJobProgress?: number`
- `errorMessage?: string`

**Default data:**
```json
{
  "label": "3D Title",
  "titlePrompt": "",
  "aspectRatio": "16:9",
  "backgroundColor": "#000000",
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
  "id": "3d-title-1",
  "type": "3d-title",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "3D Title",
    "titlePrompt": "",
    "aspectRatio": "16:9",
    "backgroundColor": "#000000",
    "fps": 30,
    "durationSeconds": 10,
    "fieldMappings": {},
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
