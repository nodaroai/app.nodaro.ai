---
node_type: router
generated_at: 2026-06-04T12:41:29.197Z
generated_from: 9bf1388db
---

# Router

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `router`
**Category:** utility
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `route_a`, `route_b`

**Required data fields:**
- `label: string`
- `mode: "radio" | "checkbox" | "conditional"`
- `routes: Array<{ id: string; name: string; active: boolean }>`

**Optional data fields:**
- `conditionGroups?: RouterConditionGroup[]`
- `activeRoutes?: string[]`
- `routeOutputs?: Record<string, string | undefined>`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`

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
