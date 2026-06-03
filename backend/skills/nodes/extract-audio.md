---
node_type: extract-audio
generated_at: 2026-06-03T16:56:58.440Z
generated_from: 98514458
---

# Extract Audio

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `extract-audio`
**Category:** processing
**Credit cost:** 1
**Inputs (target handles):** `in`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedAudioUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Extract Audio",
  "fieldMappings": {}
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
  "id": "extract-audio-1",
  "type": "extract-audio",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Extract Audio",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
