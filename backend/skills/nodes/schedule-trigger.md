---
node_type: schedule-trigger
generated_at: 2026-05-18T13:23:37.067Z
generated_from: cb1e786d
---

# Schedule Trigger

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `schedule-trigger`
**Category:** input
**Credit cost:** 0
**Inputs (target handles):** (none)
**Outputs (source handles):** `payload`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `cron?: string`
- `timezone?: string`
- `interval?: string`
- `maxExecutions?: number`

**Default data:**
```json
{
  "label": "Schedule Trigger"
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
  "id": "schedule-trigger-1",
  "type": "schedule-trigger",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Schedule Trigger"
  }
}
```
<!-- AUTO-GEN:END examples -->
