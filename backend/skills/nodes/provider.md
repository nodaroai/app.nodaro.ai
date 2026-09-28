---
node_type: provider
generated_at: 2026-09-28T22:31:07.571Z
generated_from: 261eeb7ee
---

# Provider

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `provider`
**Category:** parameter
**Credit cost:** `0` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `in`
**Outputs (source handles):** `provider`

**Required data fields:**
- `label: string`
- `category: "image" | "video" | "voice" | "script"`
- `provider: string`

**Optional data fields:**
- `model?: string`

**Default data:**
```json
{
  "label": "Provider",
  "category": "video",
  "provider": "seedance-2-fast"
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Chooses the model of the node it is wired into. Set `category` (`image` or `video`) and `provider` to a model id from that category (`list_models`), then wire the `provider` output into a node's `settings` input (Generate Video, Generate Video Pro). The value replaces that node's own `provider` at run time; one Provider node can drive several nodes.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- The model must be one the wired node runs: a Provider set to an image model (or to a video model Generate Video Pro doesn't offer) makes that node's run stop before anything is charged, naming the Provider node.
- `model` is unused; older Provider nodes may still carry it next to a vendor name, and the settings panel moves them to a real model.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "provider-1",
  "type": "provider",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Provider",
    "category": "video",
    "provider": "seedance-2-fast"
  }
}
```
<!-- AUTO-GEN:END examples -->
