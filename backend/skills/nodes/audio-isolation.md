---
node_type: audio-isolation
generated_at: 2026-05-18T13:23:37.478Z
generated_from: cb1e786d
---

# Voice Extractor

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `audio-isolation`
**Category:** ai
**Credit cost:** 1
**Inputs (target handles):** `in`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedAudioUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Voice Extractor",
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
**MCP tool:** `audio_isolation`

**Input parameters:**
- `audio_url`
- `audio_asset_id`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "audio-isolation-1",
  "type": "audio-isolation",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Voice Extractor",
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
