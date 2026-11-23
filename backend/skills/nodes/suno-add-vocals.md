---
node_type: suno-add-vocals
generated_at: 2026-11-23T07:39:00.744Z
generated_from: bf29b46fc4
---

# Suno Add Vocals

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `suno-add-vocals`
**Category:** ai
**Credit cost:** `33` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `audio`, `prompt`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `model: SunoAddTrackModel`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `prompt?: string`
- `uploadUrl?: string`
- `style?: string`
- `title?: string`
- `negativeTags?: string`
- `vocalGender?: "male" | "female"`
- `styleWeight?: number`
- `weirdnessConstraint?: number`
- `audioWeight?: number`
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
  "label": "Suno Add Vocals",
  "model": "V6",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `suno_add_vocals`

**Input parameters:**
- `audio_asset_id`
- `audio_url`
- `model`
- `style`
- `title`
- `negative_tags`
- `vocal_gender`
- `style_weight`
- `weirdness_constraint`
- `audio_weight`
- `prompt`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "suno-add-vocals-1",
  "type": "suno-add-vocals",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Suno Add Vocals",
    "model": "V6",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
