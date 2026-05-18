---
node_type: text-to-audio
generated_at: 2026-05-18T13:23:37.381Z
generated_from: cb1e786d
---

# Text to Audio

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `text-to-audio`
**Category:** ai
**Credit cost:** 3
**Inputs (target handles):** `in`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `prompt: string`
- `provider: TextToAudioProvider`
- `duration: number`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `loop?: boolean`
- `promptInfluence?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedAudioUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Text to Audio",
  "prompt": "",
  "provider": "elevenlabs-sfx",
  "duration": 10,
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `text_to_audio`

**Input parameters:**
- `prompt`
- `duration`
- `loop`
- `prompt_influence`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "text-to-audio-1",
  "type": "text-to-audio",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Text to Audio",
    "prompt": "",
    "provider": "elevenlabs-sfx",
    "duration": 10,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
