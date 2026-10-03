---
node_type: duration
generated_at: 2026-09-27T12:51:22.476Z
generated_from: c607aa02c
---

# Duration

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `duration`
**Category:** parameter
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `in`
**Outputs (source handles):** `duration`

**Required data fields:**
- `label: string`
- `seconds: number`

**Default data:**
```json
{
  "label": "Duration",
  "seconds": 60
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Sets a length in seconds. Wire its `duration` output into Generate Script's `field-targetLength` input (the script's target length) or into a Generate Video / Generate Video Pro `settings` input (the video's duration); the value replaces the node's own field at run time.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- It reports its number as text; the script coerces it to whole seconds and clamps it to 5–600.
- On Generate Video it becomes the nearest duration the model renders (60 on Seedance 2 → 15 s; a tie goes to the shorter one), and the run is priced at that length. On Generate Video Pro it is the total length to stitch, clamped to that node's range.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "duration-1",
  "type": "duration",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Duration",
    "seconds": 60
  }
}
```
<!-- AUTO-GEN:END examples -->
