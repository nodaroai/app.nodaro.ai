---
node_type: router
generated_at: 2026-05-18T13:23:37.808Z
generated_from: cb1e786d
---

# Router

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `router`
**Category:** utility
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `route_a`, `route_b`

**Default data:**
```json
{
  "label": "Router",
  "mode": "radio",
  "routes": [
    {
      "id": "default_a",
      "name": "Route A",
      "active": true
    },
    {
      "id": "default_b",
      "name": "Route B",
      "active": false
    }
  ]
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
  "id": "router-1",
  "type": "router",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Router",
    "mode": "radio",
    "routes": [
      {
        "id": "default_a",
        "name": "Route A",
        "active": true
      },
      {
        "id": "default_b",
        "name": "Route B",
        "active": false
      }
    ]
  }
}
```
<!-- AUTO-GEN:END examples -->
