---
node_type: scene-count
generated_at: 2026-09-27T10:38:38.473Z
generated_from: bf4f83575
---

# Scene Count

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `scene-count`
**Category:** parameter
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the live price is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `in`
**Outputs (source handles):** `count`

**Required data fields:**
- `label: string`
- `count: number`

**Default data:**
```json
{
  "label": "Scene Count",
  "count": 5
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Sets how many scenes a Generate Script node writes. Wire its `count` output into Generate Script's `field-sceneCount` input; the value replaces the script's own `sceneCount` at run time.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- It reports its number as text; the script coerces it to a whole number and clamps it to 1–20.
- No other node takes this connection.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "scene-count-1",
  "type": "scene-count",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Scene Count",
    "count": 5
  }
}
```
<!-- AUTO-GEN:END examples -->
