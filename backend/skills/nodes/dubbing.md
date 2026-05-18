---
node_type: dubbing
generated_at: 2026-05-18T13:23:37.496Z
generated_from: cb1e786d
---

# Dubbing

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `dubbing`
**Category:** ai
**Credit cost:** 8
**Inputs (target handles):** `in`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `targetLanguage: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `sourceLanguage?: string`
- `numSpeakers?: number`
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
  "label": "Dubbing",
  "targetLanguage": "es",
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
**MCP tool:** `dubbing`

**Input parameters:**
- `audio_url`
- `audio_asset_id`
- `target_language`
- `source_language`
- `num_speakers`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "dubbing-1",
  "type": "dubbing",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Dubbing",
    "targetLanguage": "es",
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
