---
node_type: material
generated_at: 2026-05-18T13:23:37.247Z
generated_from: cb1e786d
---

# Material

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `material`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `material: string | ReadonlyArray<string> | undefined`

**Optional data fields:**
- `preText?: string`
- `postText?: string`

**Default data:**
```json
{
  "label": "Material",
  "material": "silk"
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
  "id": "material-1",
  "type": "material",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Material",
    "material": "silk"
  }
}
```
<!-- AUTO-GEN:END examples -->
