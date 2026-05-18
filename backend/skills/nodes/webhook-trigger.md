---
node_type: webhook-trigger
generated_at: 2026-05-18T13:23:37.062Z
generated_from: cb1e786d
---

# Webhook Trigger

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `webhook-trigger`
**Category:** input
**Credit cost:** 0
**Inputs (target handles):** (none)
**Outputs (source handles):** `payload`

**Required data fields:**
- `label: string`
- `params: WebhookParam[]`

**Optional data fields:**
- `webhookToken?: string`
- `webhookUrl?: string`

**Default data:**
```json
{
  "label": "Webhook Trigger",
  "params": []
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
  "id": "webhook-trigger-1",
  "type": "webhook-trigger",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Webhook Trigger",
    "params": []
  }
}
```
<!-- AUTO-GEN:END examples -->
