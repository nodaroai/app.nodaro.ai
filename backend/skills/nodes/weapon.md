---
node_type: weapon
generated_at: 2026-05-18T13:23:37.263Z
generated_from: cb1e786d
---

# Weapon

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `weapon`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `weapon: string`

**Optional data fields:**
- `preText?: string`
- `postText?: string`

**Default data:**
```json
{
  "label": "Weapon",
  "weapon": "katana"
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
  "id": "weapon-1",
  "type": "weapon",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Weapon",
    "weapon": "katana"
  }
}
```
<!-- AUTO-GEN:END examples -->
