---
node_type: adjust-volume
generated_at: 2026-08-15T21:55:07.876Z
generated_from: 150c80ac9
---

# Adjust Volume

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `adjust-volume`
**Category:** processing
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `volume: number`
- `normalize: boolean`
- `fadeIn: number`
- `fadeOut: number`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedAudioUrl?: string`
- `generatedVideoUrl?: string`
- `lastInputType?: "audio" | "video"`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Adjust Volume",
  "volume": 100,
  "normalize": false,
  "fadeIn": 0,
  "fadeOut": 0,
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
  "id": "adjust-volume-1",
  "type": "adjust-volume",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Adjust Volume",
    "volume": 100,
    "normalize": false,
    "fadeIn": 0,
    "fadeOut": 0,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
