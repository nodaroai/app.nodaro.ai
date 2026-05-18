---
node_type: voice-design
generated_at: 2026-05-18T13:23:37.508Z
generated_from: cb1e786d
---

# Voice Design

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `voice-design`
**Category:** ai
**Credit cost:** 5
**Inputs (target handles):** `in`
**Outputs (source handles):** `audio`, `voiceId`

**Required data fields:**
- `label: string`
- `text: string`
- `voiceDescription: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `model?: VoiceDesignModel`
- `loudness?: number`
- `guidanceScale?: number`
- `seed?: number`
- `quality?: number`
- `shouldEnhance?: boolean`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedAudioUrl?: string`
- `generatedVoiceId?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "Voice Design",
  "text": "",
  "voiceDescription": "",
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
**MCP tool:** `voice_design`

**Input parameters:**
- `text`
- `voice_description`
- `loudness`
- `guidance_scale`
- `seed`
- `quality`
- `should_enhance`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "voice-design-1",
  "type": "voice-design",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Voice Design",
    "text": "",
    "voiceDescription": "",
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
