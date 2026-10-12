---
node_type: pitch-tempo
generated_at: 2026-10-11T22:28:56.862Z
generated_from: 0b269bfcc
---

# Pitch & Tempo

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `pitch-tempo`
**Category:** processing
**Credit cost:** `20-600` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `in`
**Outputs (source handles):** `audio-out`, `video-out`

**Required data fields:**
- `label: string`
- `semitones: number`
- `tempo: number`
- `preserveFormants: boolean`
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
  "label": "Pitch & Tempo",
  "semitones": 0,
  "tempo": 1,
  "preserveFormants": true,
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
  "id": "pitch-tempo-1",
  "type": "pitch-tempo",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Pitch & Tempo",
    "semitones": 0,
    "tempo": 1,
    "preserveFormants": true,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
