---
node_type: suno-separate
generated_at: 2026-10-19T10:00:40.243Z
generated_from: 1a4411516
---

# Suno Separate

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `suno-separate`
**Category:** ai
**Credit cost:** `44` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `audio`
**Outputs (source handles):** `instrumental`, `vocals`, `isolated`, `without`

**Required data fields:**
- `label: string`
- `type: SunoSeparateType`
- `taskId: string`
- `audioId: string`

**Optional data fields:**
- `stemName?: SunoStemName`
- `fallbackToDemucs?: boolean`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedAudioUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `stems?: Record<string, string>`
- `engineUsed?: "suno" | "demucs"`
- `sunoRefused?: boolean`
- `fallbackReason?: "catalog" | "too_large"`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `fieldMappings?: FieldMappings`

**Default data:**
```json
{
  "label": "Suno Separate",
  "type": "separate_vocal",
  "stemName": "Lead Vocal",
  "fallbackToDemucs": false,
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
- `audio_url`
- `audio_asset_id`
- `type`
- `stem_name`
- `fallback_to_demucs`
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
    "stemName": "Lead Vocal",
    "fallbackToDemucs": false,
    "taskId": "",
    "audioId": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
