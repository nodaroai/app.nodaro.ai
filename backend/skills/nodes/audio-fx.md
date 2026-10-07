---
node_type: audio-fx
generated_at: 2026-10-06T17:44:08.152Z
generated_from: cf92127ce
---

# Audio FX

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `audio-fx`
**Category:** processing
**Credit cost:** `20` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `in`
**Outputs (source handles):** `audio-out`

**Required data fields:**
- `label: string`
- `preset: AudioFxPreset`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `mix?: number`
- `delayMs?: number`
- `decay?: number`
- `eqLow?: number`
- `eqHigh?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedAudioUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "Audio FX",
  "preset": "room",
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
  "id": "audio-fx-1",
  "type": "audio-fx",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Audio FX",
    "preset": "room",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
