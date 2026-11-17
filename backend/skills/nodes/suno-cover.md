---
node_type: suno-cover
generated_at: 2026-11-17T08:57:45.720Z
generated_from: cb7abbeec4
---

# Suno Cover

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `suno-cover`
**Category:** ai
**Credit cost:** `33` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `audio`, `prompt`, `voice`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `prompt: string`
- `model: SunoModel`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `promptPrefix?: string`
- `promptSuffix?: string`
- `currentJobProgress?: number`
- `uploadUrl?: string`
- `lyrics?: string`
- `style?: string`
- `title?: string`
- `negativeStyle?: string`
- `vocalGender?: "male" | "female"`
- `customMode?: boolean`
- `instrumental?: boolean`
- `personaId?: string`
- `personaModel?: SunoPersonaModel`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedAudioUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Suno Cover",
  "prompt": "",
  "model": "V6",
  "uploadUrl": "",
  "lyrics": "",
  "style": "",
  "title": "",
  "negativeStyle": "",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `suno_cover`

**Input parameters:**
- `prompt`
- `audio_url`
- `audio_asset_id`
- `task_id`
- `audio_id`
- `lyrics`
- `style`
- `title`
- `instrumental`
- `custom_mode`
- `vocal_gender`
- `model`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "suno-cover-1",
  "type": "suno-cover",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Suno Cover",
    "prompt": "",
    "model": "V6",
    "uploadUrl": "",
    "lyrics": "",
    "style": "",
    "title": "",
    "negativeStyle": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
