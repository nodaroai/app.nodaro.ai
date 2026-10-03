---
node_type: voice-character
generated_at: 2026-09-27T12:51:22.788Z
generated_from: c607aa02c
---

# Voice Character

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `voice-character`
**Category:** parameter
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
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
- `hintMode?: "full" | "compact"`

**Valid values:** call `get_picker_catalog("voice-character")` (MCP) or `GET /v1/picker-catalogs/voice-character` for the catalog of valid ids.

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
