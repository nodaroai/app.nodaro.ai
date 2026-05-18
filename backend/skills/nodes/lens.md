---
node_type: lens
generated_at: 2026-05-18T13:23:37.125Z
generated_from: cb1e786d
---

# Lens

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `lens`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `lens: string`

**Optional data fields:**
- `preText?: string`
- `postText?: string`

**Default data:**
```json
{
  "label": "Lens",
  "lens": "normal-50mm"
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
  "id": "lens-1",
  "type": "lens",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Lens",
    "lens": "normal-50mm"
  }
}
```
<!-- AUTO-GEN:END examples -->
