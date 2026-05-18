---
node_type: suno-generate
generated_at: 2026-05-18T13:23:37.389Z
generated_from: cb1e786d
---

# Suno Generate

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `suno-generate`
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
- `lyrics?: string`
- `style?: string`
- `title?: string`
- `negativeStyle?: string`
- `vocalGender?: "male" | "female"`
- `styleWeight?: number`
- `weirdnessConstraint?: number`
- `audioWeight?: number`
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
  "label": "Suno Generate",
  "prompt": "",
  "model": "V5_5",
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
**MCP tool:** `suno_generate`

**Input parameters:**
- `prompt`
- `model`
- `style`
- `title`
- `lyrics`
- `negative_style`
- `vocal_gender`
- `custom_mode`
- `instrumental`
- `style_weight`
- `weirdness`
- `audio_weight`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "suno-generate-1",
  "type": "suno-generate",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Suno Generate",
    "prompt": "",
    "model": "V5_5",
    "lyrics": "",
    "style": "",
    "title": "",
    "negativeStyle": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
