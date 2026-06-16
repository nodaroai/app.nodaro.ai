---
node_type: suno-lyrics
generated_at: 2026-06-16T08:22:28.311Z
generated_from: 877dfa01a
---

# Suno Lyrics

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `suno-lyrics`
**Category:** ai
**Credit cost:** 1
**Inputs (target handles):** `prompt`
**Outputs (source handles):** `text`

**Required data fields:**
- `label: string`
- `prompt: string`

**Optional data fields:**
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedText?: string`
- `generatedTitle?: string`
- `generatedResults?: Array<{ text: string; title: string; jobId?: string }>`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `fieldMappings?: FieldMappings`

**Default data:**
```json
{
  "label": "Suno Lyrics",
  "prompt": "",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `suno_lyrics`

**Input parameters:**
- `prompt`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "suno-lyrics-1",
  "type": "suno-lyrics",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Suno Lyrics",
    "prompt": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
