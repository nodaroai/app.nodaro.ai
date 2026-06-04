---
node_type: extract-field
generated_at: 2026-06-04T12:41:29.095Z
generated_from: 9bf1388db
---

# Extract Field

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `extract-field`
**Category:** utility
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `text`

**Required data fields:**
- `label: string`
- `mode: "dropdown" | "custom"`
- `field: string`

**Optional data fields:**
- `outputType?: "text" | "list" | "json"`
- `extractedText?: string`
- `generatedJson?: unknown`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`

**Default data:**
```json
{
  "label": "Extract Field",
  "mode": "dropdown",
  "field": ""
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
  "id": "extract-field-1",
  "type": "extract-field",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Extract Field",
    "mode": "dropdown",
    "field": ""
  }
}
```
<!-- AUTO-GEN:END examples -->
