---
node_type: aspect-ratio
generated_at: 2026-09-27T10:38:38.499Z
generated_from: bf4f83575
---

# Aspect Ratio

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `aspect-ratio`
**Category:** parameter
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the live price is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `in`
**Outputs (source handles):** `ratio`

**Required data fields:**
- `label: string`
- `ratio: "1:1" | "16:9" | "9:16" | "4:3" | "4:5"`

**Default data:**
```json
{
  "label": "Aspect Ratio",
  "ratio": "16:9"
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
  "id": "aspect-ratio-1",
  "type": "aspect-ratio",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Aspect Ratio",
    "ratio": "16:9"
  }
}
```
<!-- AUTO-GEN:END examples -->
