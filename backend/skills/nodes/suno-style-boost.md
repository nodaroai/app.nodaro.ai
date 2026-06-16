---
node_type: suno-style-boost
generated_at: 2026-06-16T08:22:28.348Z
generated_from: 877dfa01a
---

# Suno Style Boost

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `suno-style-boost`
**Category:** ai
**Credit cost:** 1
**Inputs (target handles):** `prompt`
**Outputs (source handles):** `text`

**Required data fields:**
- `label: string`
- `content: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedText?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Suno Style Boost",
  "content": "",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `suno_style_boost`

**Input parameters:**
- `content`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "suno-style-boost-1",
  "type": "suno-style-boost",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Suno Style Boost",
    "content": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
