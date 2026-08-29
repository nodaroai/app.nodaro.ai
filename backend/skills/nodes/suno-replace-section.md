---
node_type: suno-replace-section
generated_at: 2026-08-29T19:02:38.717Z
generated_from: 7dbf4818b
---

# Suno Replace Section

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `suno-replace-section`
**Category:** ai
**Credit cost:** 2
**Inputs (target handles):** `audio`, `prompt`
**Outputs (source handles):** `audio`

**Required data fields:**
- `label: string`
- `infillStartS: number`
- `infillEndS: number`
- `prompt: string`
- `tags: string`
- `title: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `promptPrefix?: string`
- `promptSuffix?: string`
- `taskId?: string`
- `audioId?: string`
- `fullLyrics?: string`
- `negativeTags?: string`
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
  "label": "Suno Replace Section",
  "infillStartS": 0,
  "infillEndS": 30,
  "prompt": "",
  "tags": "",
  "title": "",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `suno_replace_section`

**Input parameters:**
- `audio_asset_id`
- `infill_start_s`
- `infill_end_s`
- `prompt`
- `tags`
- `title`
- `full_lyrics`
- `negative_tags`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "suno-replace-section-1",
  "type": "suno-replace-section",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Suno Replace Section",
    "infillStartS": 0,
    "infillEndS": 30,
    "prompt": "",
    "tags": "",
    "title": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
