---
node_type: forced-alignment
generated_at: 2026-06-16T08:22:28.453Z
generated_from: 877dfa01a
---

# Forced Alignment

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `forced-alignment`
**Category:** ai
**Credit cost:** 3
**Inputs (target handles):** `audio`, `transcript`
**Outputs (source handles):** `data`

**Required data fields:**
- `label: string`
- `transcript: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `alignmentResults?: AlignmentWord[]`
- `currentJobId?: string`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "Forced Alignment",
  "transcript": "",
  "fieldMappings": {},
  "executionStatus": "idle",
  "alignmentResults": []
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
  "id": "forced-alignment-1",
  "type": "forced-alignment",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Forced Alignment",
    "transcript": "",
    "fieldMappings": {},
    "executionStatus": "idle",
    "alignmentResults": []
  }
}
```
<!-- AUTO-GEN:END examples -->
