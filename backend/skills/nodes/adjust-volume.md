---
node_type: adjust-volume
generated_at: 2026-09-27T12:51:24.254Z
generated_from: c607aa02c
---

# Adjust Volume

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `adjust-volume`
**Category:** processing
**Credit cost:** `10` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
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
