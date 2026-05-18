---
node_type: photographer
generated_at: 2026-05-18T13:23:37.218Z
generated_from: cb1e786d
---

# Photographer / Artist Style

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `photographer`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `photographer: string | ReadonlyArray<string> | undefined`

**Optional data fields:**
- `preText?: string`
- `postText?: string`

**Default data:**
```json
{
  "label": "Photographer",
  "photographer": "tim-walker"
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
  "id": "photographer-1",
  "type": "photographer",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Photographer",
    "photographer": "tim-walker"
  }
}
```
<!-- AUTO-GEN:END examples -->
