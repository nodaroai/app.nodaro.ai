---
node_type: transcribe
generated_at: 2026-05-18T13:23:37.466Z
generated_from: cb1e786d
---

# Transcribe

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `transcribe`
**Category:** ai
**Credit cost:** 3
**Inputs (target handles):** `in`
**Outputs (source handles):** `text`

**Required data fields:**
- `label: string`
- `provider: TranscribeProvider`
- `language: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `diarize?: boolean`
- `tagAudioEvents?: boolean`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `currentJobProgress?: number`
- `errorMessage?: string`
- `generatedText?: string`
- `generatedResults?: Array<{ text: string; language: string; jobId: string; timestamp: string }>`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Transcribe",
  "provider": "elevenlabs-stt",
  "language": "auto",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `transcribe`

**Input parameters:**
- `audio_url`
- `audio_asset_id`
- `language`
- `diarize`
- `tag_audio_events`
- `word_timestamps`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "transcribe-1",
  "type": "transcribe",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Transcribe",
    "provider": "elevenlabs-stt",
    "language": "auto",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
