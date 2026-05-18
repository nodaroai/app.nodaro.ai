---
node_type: framing
generated_at: 2026-05-18T13:23:37.121Z
generated_from: cb1e786d
---

# Framing

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `framing`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `shotSize?: string`
- `angle?: string`
- `coverage?: string`
- `composition?: string | ReadonlyArray<string>`
- `vantage?: string`
- `maxItemsPerRow?: number`
- `preText?: string`
- `postText?: string`

**Default data:**
```json
{
  "label": "Framing",
  "shotSize": "wide-shot"
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
  "id": "framing-1",
  "type": "framing",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Framing",
    "shotSize": "wide-shot"
  }
}
```
<!-- AUTO-GEN:END examples -->
