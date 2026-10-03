---
node_type: music-genre
generated_at: 2026-09-27T12:51:22.741Z
generated_from: c607aa02c
---

# Music Genre

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `music-genre`
**Category:** parameter
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
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
- `hintMode?: "full" | "compact"`

**Valid values:** call `get_picker_catalog("music-genre")` (MCP) or `GET /v1/picker-catalogs/music-genre` for the catalog of valid ids.

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
