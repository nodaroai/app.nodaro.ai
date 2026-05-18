---
node_type: suno-separate
generated_at: 2026-05-18T13:23:37.412Z
generated_from: cb1e786d
---

# Suno Separate

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `suno-separate`
**Category:** ai
**Credit cost:** 2
**Inputs (target handles):** `audio`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `type: "separate_vocal" | "split_stem"`
- `taskId: string`
- `audioId: string`

**Optional data fields:**
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedAudioUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `vocalUrl?: string`
- `instrumentalUrl?: string`
- `stems?: Record<string, string>`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `fieldMappings?: FieldMappings`

**Default data:**
```json
{
  "label": "Suno Separate",
  "type": "separate_vocal",
  "taskId": "",
  "audioId": "",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `suno_separate_stems`

**Input parameters:**
- `audio_asset_id`
- `type`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "suno-separate-1",
  "type": "suno-separate",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Suno Separate",
    "type": "separate_vocal",
    "taskId": "",
    "audioId": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
