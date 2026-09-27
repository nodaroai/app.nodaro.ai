---
node_type: duration
generated_at: 2026-09-21T19:12:08.777Z
generated_from: 09788c987
---

# Duration

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `duration`
**Category:** parameter
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the live price is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
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

Sets a Generate Script node's target length in seconds. Wire its `duration` output into Generate Script's `field-targetLength` input; the value replaces the script's own `targetLength` at run time.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- It reports its number as text; the script coerces it to whole seconds and clamps it to 5–600.
- Video and audio generation nodes don't take this connection.

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
