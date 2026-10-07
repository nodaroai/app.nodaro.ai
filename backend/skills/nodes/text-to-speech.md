---
node_type: text-to-speech
generated_at: 2026-10-06T09:25:55.626Z
generated_from: 092785bc3
---

# Text to Speech

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `text-to-speech`
**Category:** ai
**Credit cost:** `15-30` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `prompt`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `provider: TtsProvider`
- `voiceId: string`
- `voiceType: "premade" | "custom" | "library"`
- `voiceDisplayName: string`
- `language: string`
- `speed: number`
- `stability: number`
- `similarityBoost: number`
- `style: number`
- `languageCode: string`
- `textSource: "connected" | "direct"`
- `directText: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `promptPrefix?: string`
- `promptSuffix?: string`
- `currentJobProgress?: number`
- `voiceLabel?: string`
- `previousText?: string`
- `nextText?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedAudioUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Text to Speech",
  "provider": "elevenlabs-v4",
  "voiceId": "Rachel",
  "voiceType": "premade",
  "voiceDisplayName": "Rachel",
  "language": "en",
  "speed": 1,
  "stability": 0.5,
  "similarityBoost": 0.75,
  "style": 0,
  "languageCode": "",
  "textSource": "connected",
  "directText": "",
  "previousText": "",
  "nextText": "",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `generate_speech`

**Input parameters:**
- `text`
- `presetId`
- `voice_id`
- `model`
- `voice_type`
- `stability`
- `similarity_boost`
- `style`
- `speed`
- `language_code`
- `previous_text`
- `next_text`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "text-to-speech-1",
  "type": "text-to-speech",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Text to Speech",
    "provider": "elevenlabs-v4",
    "voiceId": "Rachel",
    "voiceType": "premade",
    "voiceDisplayName": "Rachel",
    "language": "en",
    "speed": 1,
    "stability": 0.5,
    "similarityBoost": 0.75,
    "style": 0,
    "languageCode": "",
    "textSource": "connected",
    "directText": "",
    "previousText": "",
    "nextText": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
