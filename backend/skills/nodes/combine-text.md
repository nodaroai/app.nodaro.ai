---
node_type: combine-text
generated_at: 2026-06-04T12:41:29.078Z
generated_from: 9bf1388db
---

# Combine Text

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `combine-text`
**Category:** utility
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `text`

**Required data fields:**
- `label: string`
- `separator: "newline" | "comma" | "space" | "double-newline" | "stars" | "custom"`
- `customSeparator: string`
- `combinedText: string`

**Optional data fields:**
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`

**Default data:**
```json
{
  "label": "Combine Text",
  "separator": "newline",
  "customSeparator": "",
  "combinedText": ""
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
  "id": "combine-text-1",
  "type": "combine-text",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Combine Text",
    "separator": "newline",
    "customSeparator": "",
    "combinedText": ""
  }
}
```
<!-- AUTO-GEN:END examples -->
