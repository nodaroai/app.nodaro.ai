---
node_type: text-to-speech
generated_at: 2026-05-18T13:23:37.364Z
generated_from: cb1e786d
---

# Text to Speech

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `text-to-speech`
**Category:** ai
**Credit cost:** 3
**Inputs (target handles):** `in`
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
- `currentJobProgress?: number`
- `voiceLabel?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedAudioUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Text to Speech",
  "provider": "elevenlabs-v3",
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
- `voice_id`
- `model`
- `voice_type`
- `stability`
- `similarity_boost`
- `style`
- `speed`
- `language_code`
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
    "provider": "elevenlabs-v3",
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
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
