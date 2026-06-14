---
node_type: describe-to-picker
generated_at: 2026-06-14T16:32:35.556Z
generated_from: c7e81348f
---

# Describe to Picker

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `describe-to-picker`
**Category:** ai
**Credit cost:** 1
**Inputs (target handles):** `image`
**Outputs (source handles):** `picker-json`

**Required data fields:**
- `label: string`
- `targetPicker: "person"`

**Optional data fields:**
- `llmModel?: string`
- `instructions?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `currentJobProgress?: number`
- `errorMessage?: string`
- `generatedPickerJson?: Record<string, unknown>`
- `generatedResults?: Array<{ pickerJson: Record<string, unknown>; jobId: string; timestamp: string }>`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Describe to Picker",
  "targetPicker": "person"
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
  "id": "describe-to-picker-1",
  "type": "describe-to-picker",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Describe to Picker",
    "targetPicker": "person"
  }
}
```
<!-- AUTO-GEN:END examples -->
