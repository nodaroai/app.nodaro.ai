---
node_type: character-fx
generated_at: 2026-05-20T13:15:49.158Z
generated_from: 806ad950
---

# Character FX

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `character-fx`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `characterFx: string | string[]`

**Optional data fields:**
- `position?: CharacterFxPosition`
- `duration?: CharacterFxDuration`
- `intensity?: CharacterFxIntensity`
- `preText?: string`
- `postText?: string`

**Default data:**
```json
{
  "label": "Character FX",
  "characterFx": "auto",
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
  "id": "character-fx-1",
  "type": "character-fx",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Character FX",
    "characterFx": "auto",
    "position": "auto",
    "duration": "auto",
    "intensity": "auto"
  }
}
```
<!-- AUTO-GEN:END examples -->
