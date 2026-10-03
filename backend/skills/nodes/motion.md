---
node_type: motion
generated_at: 2026-09-27T12:51:22.506Z
generated_from: c607aa02c
---

# Motion

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `motion`
**Category:** parameter
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `motion: "subtle" | "moderate" | "dynamic"`

**Default data:**
```json
{
  "label": "Motion",
  "motion": "moderate"
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Sets how much a video moves. Wire its `out` output into a Generate Video or Generate Video Pro `settings` input; it adds a clause to the prompt — `subtle` → "subtle, gentle motion with slow, minimal movement", `moderate` → "moderate, natural motion at an even pace", `dynamic` → "dynamic, energetic motion with fast, pronounced movement".

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- It sets no field: it is a prompt clause, beside the Look family's hints, and follows the consumer's `injectLook` switch.
- Video only — still-image nodes never take it. With two Motion nodes wired into one node, the last edge wins.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "motion-1",
  "type": "motion",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Motion",
    "motion": "moderate"
  }
}
```
<!-- AUTO-GEN:END examples -->
