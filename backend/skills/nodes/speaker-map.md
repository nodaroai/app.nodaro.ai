---
node_type: speaker-map
generated_at: 2026-10-19T09:07:22.565Z
generated_from: e90457960
---

# Speaker Map

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `speaker-map`
**Category:** processing
**Credit cost:** `11` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `sources`, `offsets`, `transcript`
**Outputs (source handles):** `json`, `edl`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobProgress?: number`
- `sourceOrder?: string[]`
- `masterSourceId?: string`
- `wideSourceId?: string`
- `marginDb?: number`
- `generatedJson?: SpeakerMapResult`
- `generatedEdl?: Edl`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Speaker Map",
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
  "id": "speaker-map-1",
  "type": "speaker-map",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Speaker Map",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
