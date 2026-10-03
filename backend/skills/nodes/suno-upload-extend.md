---
node_type: suno-upload-extend
generated_at: 2026-09-27T12:51:23.633Z
generated_from: c607aa02c
---

# Suno Upload Extend

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `suno-upload-extend`
**Category:** ai
**Credit cost:** `30` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `audio`, `prompt`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `prompt: string`
- `model: SunoModel`
- `style: string`
- `title: string`
- `negativeStyle: string`
- `vocalGender: string`
- `continueAt: number`
- `defaultParamFlag: boolean`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `promptPrefix?: string`
- `promptSuffix?: string`
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
  "label": "Suno Upload Extend",
  "prompt": "",
  "model": "V6",
  "style": "",
  "title": "",
  "negativeStyle": "",
  "vocalGender": "",
  "continueAt": 0,
  "defaultParamFlag": true,
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `suno_upload_extend`

**Input parameters:**
- `audio_url`
- `continue_at`
- `model`
- `style`
- `title`
- `negative_style`
- `vocal_gender`
- `use_default_params`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "suno-upload-extend-1",
  "type": "suno-upload-extend",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Suno Upload Extend",
    "prompt": "",
    "model": "V6",
    "style": "",
    "title": "",
    "negativeStyle": "",
    "vocalGender": "",
    "continueAt": 0,
    "defaultParamFlag": true,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
