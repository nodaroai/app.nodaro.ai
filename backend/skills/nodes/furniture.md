---
node_type: furniture
generated_at: 2026-05-20T13:30:18.888Z
generated_from: a183bc77
---

# Furniture

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `furniture`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `furniture: string`

**Optional data fields:**
- `preText?: string`
- `postText?: string`

**Default data:**
```json
{
  "label": "Furniture",
  "furniture": "sofa"
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
  "id": "furniture-1",
  "type": "furniture",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Furniture",
    "furniture": "sofa"
  }
}
```
<!-- AUTO-GEN:END examples -->
