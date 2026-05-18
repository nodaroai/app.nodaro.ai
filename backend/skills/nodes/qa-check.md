---
node_type: qa-check
generated_at: 2026-05-18T13:23:37.369Z
generated_from: cb1e786d
---

# QA Check

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `qa-check`
**Category:** ai
**Credit cost:** 1
**Inputs (target handles):** `in`
**Outputs (source handles):** `approved`, `rejected`

**Default data:**
```json
{
  "label": "QA Check",
  "provider": "claude",
  "checkType": "quality",
  "threshold": 0.8,
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
  "id": "qa-check-1",
  "type": "qa-check",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "QA Check",
    "provider": "claude",
    "checkType": "quality",
    "threshold": 0.8,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
