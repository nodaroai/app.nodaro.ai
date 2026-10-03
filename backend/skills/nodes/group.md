---
node_type: group
generated_at: 2026-09-27T12:51:25.339Z
generated_from: c607aa02c
---

# Group

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `group`
**Category:** utility
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** (none)
**Outputs (source handles):** (none)

**Required data fields:**
- `label: string`

**Optional data fields:**
- `color?: string`

**Default data:**
```json
{
  "label": "New group"
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
  "id": "group-1",
  "type": "group",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "New group"
  }
}
```
<!-- AUTO-GEN:END examples -->
