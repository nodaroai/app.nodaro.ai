---
node_type: speed-ramp
generated_at: 2026-10-05T21:37:07.488Z
generated_from: 066cc1460
---

# Adjust Speed

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `speed-ramp`
**Category:** processing
**Credit cost:** `20-50` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `video`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `speed: number`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `reverse?: boolean`
- `audioMode?: "pitch-preserve" | "pitch-shift" | "drop"`
- `quality?: "fast" | "smooth"`
- `ramps?: ReadonlyArray<SpeedRampSegment>`
- `adjustAudio?: boolean`
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
  "reverse": false,
  "audioMode": "pitch-preserve",
  "quality": "fast",
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
    "reverse": false,
    "audioMode": "pitch-preserve",
    "quality": "fast",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
