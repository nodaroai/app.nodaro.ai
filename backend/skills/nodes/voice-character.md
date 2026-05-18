---
node_type: voice-character
generated_at: 2026-05-18T13:23:37.192Z
generated_from: cb1e786d
---

# Voice Character

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `voice-character`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `preText?: string`
- `postText?: string`
- `age?: string`
- `gender?: string`
- `language?: string | ReadonlyArray<string>`
- `accent?: string`
- `timbre?: string`

**Default data:**
```json
{
  "label": "Voice Character"
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "voice-character-1",
  "type": "voice-character",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Voice Character"
  }
}
```
<!-- AUTO-GEN:END examples -->
