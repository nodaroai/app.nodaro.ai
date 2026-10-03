---
node_type: teleport-receive
generated_at: 2026-09-27T12:51:25.392Z
generated_from: c607aa02c
---

# Teleport Receive

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `teleport-receive`
**Category:** utility
**Credit cost:** `0` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `channel: string`
- `channelColor: string`

**Optional data fields:**
- `result?: string`

**Default data:**
```json
{
  "label": "A",
  "channel": "A",
  "channelColor": "#f59e0b"
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
  "id": "teleport-receive-1",
  "type": "teleport-receive",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "A",
    "channel": "A",
    "channelColor": "#f59e0b"
  }
}
```
<!-- AUTO-GEN:END examples -->
