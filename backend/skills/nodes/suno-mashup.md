---
node_type: suno-mashup
generated_at: 2026-05-18T13:23:37.424Z
generated_from: cb1e786d
---

# Suno Mashup

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `suno-mashup`
**Category:** ai
**Credit cost:** 4
**Inputs (target handles):** `audio1`, `audio2`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `model: SunoModel`
- `customMode: boolean`
- `style: string`
- `title: string`
- `negativeStyle: string`
- `vocalGender: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
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
  "label": "Suno Mashup",
  "model": "V5_5",
  "customMode": false,
  "style": "",
  "title": "",
  "negativeStyle": "",
  "vocalGender": "",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `suno_mashup`

**Input parameters:**
- `audio_url_1`
- `audio_asset_id_1`
- `audio_url_2`
- `audio_asset_id_2`
- `style`
- `title`
- `negative_style`
- `vocal_gender`
- `custom_mode`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "suno-mashup-1",
  "type": "suno-mashup",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Suno Mashup",
    "model": "V5_5",
    "customMode": false,
    "style": "",
    "title": "",
    "negativeStyle": "",
    "vocalGender": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
