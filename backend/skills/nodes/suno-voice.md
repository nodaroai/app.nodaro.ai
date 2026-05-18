---
node_type: suno-voice
generated_at: 2026-05-18T20:01:15.985Z
generated_from: 866224d8
---

# Suno Voice

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `suno-voice`
**Category:** parameter
**Credit cost:** 20
**Inputs (target handles):** (none)
**Outputs (source handles):** `voicePersona`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `sourceAudioUrl?: string`
- `sourceVocalStartS?: number`
- `sourceVocalEndS?: number`
- `language?: SunoVoiceLanguage`
- `validateTaskId?: string`
- `validateInfo?: string`
- `verifyAudioUrl?: string`
- `voiceName?: string`
- `description?: string`
- `style?: string`
- `singerSkillLevel?: SunoVoiceSkillLevel`
- `voiceId?: string`
- `status?: SunoVoiceStatus`
- `errorMessage?: string`
- `generateJobId?: string`
- `generateKieTaskId?: string`

**Default data:**
```json
{
  "label": "Suno Voice",
  "status": "idle"
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "suno-voice-1",
  "type": "suno-voice",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Suno Voice",
    "status": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
