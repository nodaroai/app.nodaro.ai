---
node_type: suno-generate
generated_at: 2026-09-27T12:51:23.461Z
generated_from: c607aa02c
---

# Suno Create Music

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `suno-generate`
**Category:** ai
**Credit cost:** `30` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `prompt`, `audio-style`, `voice`, `field-style`, `field-lyrics`, `field-title`, `field-negativeStyle`
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
- `lyrics?: string`
- `style?: string`
- `title?: string`
- `negativeStyle?: string`
- `vocalGender?: "male" | "female"`
- `styleWeight?: number`
- `weirdnessConstraint?: number`
- `audioWeight?: number`
- `customMode?: boolean`
- `advancedOpen?: boolean`
- `instrumental?: boolean`
- `duration?: number`
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
  "label": "Suno Create Music",
  "prompt": "",
  "model": "V6",
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
- `duration`
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
    "label": "Suno Create Music",
    "prompt": "",
    "model": "V6",
    "lyrics": "",
    "style": "",
    "title": "",
    "negativeStyle": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
