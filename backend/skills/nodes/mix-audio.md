---
node_type: mix-audio
generated_at: 2026-10-14T09:49:18.126Z
generated_from: 2c6fb981c
---

# Mix Audio

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `mix-audio`
**Category:** processing
**Credit cost:** `22` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `in`
**Outputs (source handles):** `audio-out`

**Required data fields:**
- `label: string`
- `trackCount: number`
- `trackVolumes: Record<string, number>`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `trackOrder?: string[]`
- `duckUnder?: string`
- `duckAmount?: number`
- `endAt?: "longest" | "voice"`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedAudioUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Mix Audio",
  "trackCount": 2,
  "trackVolumes": {},
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
  "id": "mix-audio-1",
  "type": "mix-audio",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Mix Audio",
    "trackCount": 2,
    "trackVolumes": {},
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
