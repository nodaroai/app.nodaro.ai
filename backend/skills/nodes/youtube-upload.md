---
node_type: youtube-upload
generated_at: 2026-09-27T12:51:25.512Z
generated_from: c607aa02c
---

# YouTube Upload

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `youtube-upload`
**Category:** output
**Credit cost:** `10` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `in`
**Outputs (source handles):** (none)

**Default data:**
```json
{
  "label": "YouTube Upload",
  "platform": "youtube",
  "action": "upload-video",
  "caption": "",
  "title": "",
  "description": "",
  "tags": [],
  "privacy": "private",
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
  "id": "youtube-upload-1",
  "type": "youtube-upload",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "YouTube Upload",
    "platform": "youtube",
    "action": "upload-video",
    "caption": "",
    "title": "",
    "description": "",
    "tags": [],
    "privacy": "private",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
