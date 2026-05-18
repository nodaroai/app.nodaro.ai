---
node_type: voice-changer
generated_at: 2026-05-18T13:23:37.489Z
generated_from: cb1e786d
---

# Voice Changer

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `voice-changer`
**Category:** ai
**Credit cost:** 4
**Inputs (target handles):** `in`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `voiceId: string`
- `voiceLabel: string`
- `voiceType: "premade" | "custom" | "library"`
- `stability: number`
- `similarityBoost: number`
- `removeBackgroundNoise: boolean`
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
  "label": "Voice Changer",
  "voiceId": "",
  "voiceLabel": "",
  "voiceType": "premade",
  "stability": 0.5,
  "similarityBoost": 0.75,
  "removeBackgroundNoise": false,
  "fieldMappings": {},
  "executionStatus": "idle",
  "generatedResults": [],
  "activeResultIndex": 0
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `voice_changer`

**Input parameters:**
- `audio_url`
- `audio_asset_id`
- `voice_id`
- `stability`
- `similarity_boost`
- `remove_background_noise`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "voice-changer-1",
  "type": "voice-changer",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Voice Changer",
    "voiceId": "",
    "voiceLabel": "",
    "voiceType": "premade",
    "stability": 0.5,
    "similarityBoost": 0.75,
    "removeBackgroundNoise": false,
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
