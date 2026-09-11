---
node_type: suno-add-vocals
generated_at: 2026-09-10T23:12:24.889Z
generated_from: 15c8b1229
---

# Suno Add Vocals

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `suno-add-vocals`
**Category:** ai
**Credit cost:** 4
**Inputs (target handles):** `audio`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `model: SunoAddTrackModel`
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
  "label": "Suno Add Vocals",
  "model": "V6",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `suno_add_vocals`

**Input parameters:**
- `audio_asset_id`
- `model`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "suno-add-vocals-1",
  "type": "suno-add-vocals",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Suno Add Vocals",
    "model": "V6",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
