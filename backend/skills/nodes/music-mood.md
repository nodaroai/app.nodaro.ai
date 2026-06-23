---
node_type: music-mood
generated_at: 2026-06-23T16:51:38.095Z
generated_from: 52fc7de9b
---

# Music Mood

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `music-mood`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `preText?: string`
- `postText?: string`
- `energy?: string`
- `emotion?: string | ReadonlyArray<string>`
- `vibe?: string | ReadonlyArray<string>`

**Valid values:** call `get_picker_catalog("music-mood")` (MCP) or `GET /v1/picker-catalogs/music-mood` for the catalog of valid ids.

**Default data:**
```json
{
  "label": "Music Mood"
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
  "id": "music-mood-1",
  "type": "music-mood",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Music Mood"
  }
}
```
<!-- AUTO-GEN:END examples -->
