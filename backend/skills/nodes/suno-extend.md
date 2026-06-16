---
node_type: suno-extend
generated_at: 2026-06-16T08:22:28.305Z
generated_from: 877dfa01a
---

# Suno Extend

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `suno-extend`
**Category:** ai
**Credit cost:** 3
**Inputs (target handles):** `audio`, `prompt`, `voice`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `audioId: string`
- `defaultParamFlag: boolean`
- `prompt: string`
- `model: SunoModel`

**Optional data fields:**
- `style?: string`
- `title?: string`
- `continueAt?: number`
- `negativeStyle?: string`
- `vocalGender?: "male" | "female"`
- `styleWeight?: number`
- `weirdnessConstraint?: number`
- `audioWeight?: number`
- `instrumental?: boolean`
- `personaId?: string`
- `personaModel?: SunoPersonaModel`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedAudioUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `fieldMappings?: FieldMappings`

**Default data:**
```json
{
  "label": "Suno Extend",
  "audioId": "",
  "defaultParamFlag": true,
  "prompt": "",
  "model": "V5_5",
  "style": "",
  "title": "",
  "continueAt": 0,
  "negativeStyle": "",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `suno_extend`

**Input parameters:**
- `audio_asset_id`
- `prompt`
- `style`
- `title`
- `continue_at`
- `model`
- `vocal_gender`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "suno-extend-1",
  "type": "suno-extend",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Suno Extend",
    "audioId": "",
    "defaultParamFlag": true,
    "prompt": "",
    "model": "V5_5",
    "style": "",
    "title": "",
    "continueAt": 0,
    "negativeStyle": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
