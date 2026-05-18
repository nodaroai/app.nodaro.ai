---
node_type: setting
generated_at: 2026-05-18T13:23:37.164Z
generated_from: cb1e786d
---

# Setting

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `setting`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `setting: string`

**Optional data fields:**
- `preText?: string`
- `postText?: string`

**Default data:**
```json
{
  "label": "Setting",
  "setting": "forest"
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
  "id": "setting-1",
  "type": "setting",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Setting",
    "setting": "forest"
  }
}
```
<!-- AUTO-GEN:END examples -->
