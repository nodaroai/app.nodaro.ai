---
node_type: suno-convert-wav
generated_at: 2026-08-15T21:55:07.121Z
generated_from: 150c80ac9
---

# Suno Convert WAV

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `suno-convert-wav`
**Category:** ai
**Credit cost:** 1
**Inputs (target handles):** `audio`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `taskId?: string`
- `audioId?: string`
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
  "label": "Suno Convert WAV",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `suno_convert_wav`

**Input parameters:**
- `audio_asset_id`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "suno-convert-wav-1",
  "type": "suno-convert-wav",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Suno Convert WAV",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
