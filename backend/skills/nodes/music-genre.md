---
node_type: music-genre
generated_at: 2026-05-18T13:23:37.176Z
generated_from: cb1e786d
---

# Music Genre

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `music-genre`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `preText?: string`
- `postText?: string`
- `genre?: string | ReadonlyArray<string>`
- `subgenre?: string`
- `era?: string`

**Default data:**
```json
{
  "label": "Music Genre"
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
  "id": "music-genre-1",
  "type": "music-genre",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Music Genre"
  }
}
```
<!-- AUTO-GEN:END examples -->
