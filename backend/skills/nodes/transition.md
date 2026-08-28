---
node_type: transition
generated_at: 2026-08-28T10:30:57.356Z
generated_from: ae8d76277
---

# Transition

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `transition`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `transition: string | string[]`

**Optional data fields:**
- `position?: TransitionPosition`
- `duration?: TransitionDuration`
- `intensity?: TransitionIntensity`
- `preText?: string`
- `postText?: string`
- `hintMode?: "full" | "compact"`

**Valid values:** call `get_picker_catalog("transition")` (MCP) or `GET /v1/picker-catalogs/transition` for the catalog of valid ids.

**Default data:**
```json
{
  "label": "Transition",
  "transition": "auto",
  "position": "auto",
  "duration": "auto",
  "intensity": "auto"
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
  "id": "transition-1",
  "type": "transition",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Transition",
    "transition": "auto",
    "position": "auto",
    "duration": "auto",
    "intensity": "auto"
  }
}
```
<!-- AUTO-GEN:END examples -->
