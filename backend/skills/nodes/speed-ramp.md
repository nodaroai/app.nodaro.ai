---
node_type: speed-ramp
generated_at: 2026-05-18T13:23:37.628Z
generated_from: cb1e786d
---

# Adjust Speed

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `speed-ramp`
**Category:** processing
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `speed: number`
- `adjustAudio: boolean`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Adjust Speed",
  "speed": 1,
  "adjustAudio": true,
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
  "id": "speed-ramp-1",
  "type": "speed-ramp",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Adjust Speed",
    "speed": 1,
    "adjustAudio": true,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
