---
node_type: voice-remix
generated_at: 2026-06-16T08:22:28.439Z
generated_from: 877dfa01a
---

# Voice Remix

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `voice-remix`
**Category:** ai
**Credit cost:** 4
**Inputs (target handles):** `audio`, `audio-style`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `text: string`
- `voiceDescription: string`
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
  "label": "Voice Remix",
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
**MCP tool:** `voice_remix`

**Input parameters:**
- `text`
- `voice_description`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "voice-remix-1",
  "type": "voice-remix",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Voice Remix",
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
