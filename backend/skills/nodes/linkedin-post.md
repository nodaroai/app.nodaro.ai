---
node_type: linkedin-post
generated_at: 2026-09-27T12:51:25.540Z
generated_from: c607aa02c
---

# LinkedIn Post

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `linkedin-post`
**Category:** output
**Credit cost:** `10` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `in`
**Outputs (source handles):** (none)

**Default data:**
```json
{
  "label": "LinkedIn Post",
  "platform": "linkedin",
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
  "id": "linkedin-post-1",
  "type": "linkedin-post",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "LinkedIn Post",
    "platform": "linkedin",
    "action": "post-image",
    "caption": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
