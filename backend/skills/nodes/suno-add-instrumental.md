---
node_type: suno-add-instrumental
generated_at: 2026-09-27T12:51:23.589Z
generated_from: c607aa02c
---

# Suno Add Instrumental

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `suno-add-instrumental`
**Category:** ai
**Credit cost:** `30` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `audio`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `model: SunoAddTrackModel`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `taskId?: string`
- `audioId?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedAudioUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "Suno Add Instrumental",
  "model": "V6",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `suno_add_instrumental`

**Input parameters:**
- `audio_asset_id`
- `model`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "suno-add-instrumental-1",
  "type": "suno-add-instrumental",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Suno Add Instrumental",
    "model": "V6",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
