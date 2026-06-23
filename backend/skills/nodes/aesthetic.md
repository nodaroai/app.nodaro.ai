---
node_type: aesthetic
generated_at: 2026-06-23T16:51:38.143Z
generated_from: 52fc7de9b
---

# Aesthetic / Microtrend

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `aesthetic`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `aesthetic: string | ReadonlyArray<string> | undefined`

**Optional data fields:**
- `preText?: string`
- `postText?: string`

**Valid values:** call `get_picker_catalog("aesthetic")` (MCP) or `GET /v1/picker-catalogs/aesthetic` for the catalog of valid ids.

**Default data:**
```json
{
  "label": "Aesthetic",
  "aesthetic": "y2k"
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
  "id": "aesthetic-1",
  "type": "aesthetic",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Aesthetic",
    "aesthetic": "y2k"
  }
}
```
<!-- AUTO-GEN:END examples -->
