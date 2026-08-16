---
node_type: duration
generated_at: 2026-08-15T21:55:05.842Z
generated_from: 150c80ac9
---

# Duration

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `duration`
**Category:** parameter
**Credit cost:** 0
**Inputs (target handles):** `in`
**Outputs (source handles):** `duration`

**Required data fields:**
- `label: string`
- `seconds: number`

**Default data:**
```json
{
  "label": "Duration",
  "seconds": 60
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
  "id": "duration-1",
  "type": "duration",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Duration",
    "seconds": 60
  }
}
```
<!-- AUTO-GEN:END examples -->
