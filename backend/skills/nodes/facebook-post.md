---
node_type: facebook-post
generated_at: 2026-09-27T12:51:25.591Z
generated_from: c607aa02c
---

# Facebook Post

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `facebook-post`
**Category:** output
**Credit cost:** `10` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `in`
**Outputs (source handles):** (none)

**Default data:**
```json
{
  "label": "Facebook Post",
  "platform": "facebook",
  "action": "post-image",
  "caption": "",
  "fieldMappings": {}
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
  "id": "facebook-post-1",
  "type": "facebook-post",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Facebook Post",
    "platform": "facebook",
    "action": "post-image",
    "caption": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
