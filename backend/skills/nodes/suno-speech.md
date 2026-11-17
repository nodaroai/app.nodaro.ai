---
node_type: suno-speech
generated_at: 2026-11-17T08:57:46.371Z
generated_from: cb7abbeec4
---

# Suno Speech

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `suno-speech`
**Category:** ai
**Credit cost:** `33` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `prompt`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `mode?: SunoSpeechMode`
- `prompt?: string`
- `script?: string`
- `tone?: string`
- `variety?: number`
- `vocalGender?: SunoSpeechVocalGender`
- `backgroundMusic?: boolean`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `generatedAudioUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Suno Speech",
  "mode": "brief",
  "prompt": "",
  "script": "",
  "tone": "",
  "backgroundMusic": false,
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `suno_speech`

**Input parameters:**
- `mode`
- `prompt`
- `script`
- `tone`
- `variety`
- `vocal_gender`
- `background_music`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "suno-speech-1",
  "type": "suno-speech",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Suno Speech",
    "mode": "brief",
    "prompt": "",
    "script": "",
    "tone": "",
    "backgroundMusic": false,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
