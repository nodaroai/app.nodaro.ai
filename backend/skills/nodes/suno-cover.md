---
node_type: suno-cover
generated_at: 2026-05-18T13:23:37.394Z
generated_from: cb1e786d
---

# Suno Cover

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `suno-cover`
**Category:** ai
**Credit cost:** 3
**Inputs (target handles):** `in`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `prompt: string`
- `model: SunoModel`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `uploadUrl?: string`
- `lyrics?: string`
- `style?: string`
- `title?: string`
- `negativeStyle?: string`
- `vocalGender?: "male" | "female"`
- `customMode?: boolean`
- `instrumental?: boolean`
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
  "model": "V5_5",
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
    "model": "V5_5",
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
