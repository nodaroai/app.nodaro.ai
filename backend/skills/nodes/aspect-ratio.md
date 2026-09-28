---
node_type: aspect-ratio
generated_at: 2026-09-27T12:51:22.488Z
generated_from: c607aa02c
---

# Aspect Ratio

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `aspect-ratio`
**Category:** parameter
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
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

Sets the aspect ratio of the node it is wired into. Wire its `ratio` output into a Generate Video or Generate Video Pro `settings` input; the value replaces the node's own `aspectRatio` at run time.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- A ratio the model doesn't render is fitted to the nearest one it does (e.g. `4:5` on Seedance 2 runs as `3:4`); the node's chips show the fitted ratio.

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
