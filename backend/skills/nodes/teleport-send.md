---
node_type: teleport-send
generated_at: 2026-05-18T13:23:37.818Z
generated_from: cb1e786d
---

# Teleport Send

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `teleport-send`
**Category:** utility
**Credit cost:** 0
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
  "id": "teleport-send-1",
  "type": "teleport-send",
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
