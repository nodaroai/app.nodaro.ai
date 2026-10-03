---
node_type: combine-audio
generated_at: 2026-09-27T12:51:24.242Z
generated_from: c607aa02c
---

# Combine Audio

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `combine-audio`
**Category:** processing
**Credit cost:** `10` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `in`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `segmentOrder?: string[]`
- `segmentSettings?: Record<string, { startTime?: number; endTime?: number; volume?: number }>`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedAudioUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`

**Default data:**
```json
{
  "label": "Combine Audio",
  "segmentOrder": [],
  "segmentSettings": {},
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
  "id": "combine-audio-1",
  "type": "combine-audio",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Combine Audio",
    "segmentOrder": [],
    "segmentSettings": {},
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
