---
node_type: style-guide
generated_at: 2026-09-27T10:38:38.439Z
generated_from: bf4f83575
---

# Style Guide

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `style-guide`
**Category:** parameter
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the live price is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `in`
**Outputs (source handles):** `style`

**Required data fields:**
- `label: string`
- `text: string`

**Default data:**
```json
{
  "label": "Style Guide",
  "text": ""
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Holds free-text style direction. Wire its `style` output into Generate Script's `field-styleGuide` input; the script follows it instead of the style guide typed in its panel.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- Only Generate Script takes this connection.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "style-guide-1",
  "type": "style-guide",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Style Guide",
    "text": ""
  }
}
```
<!-- AUTO-GEN:END examples -->
