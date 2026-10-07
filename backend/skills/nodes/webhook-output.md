---
node_type: webhook-output
generated_at: 2026-10-06T17:44:09.081Z
generated_from: cf92127ce
---

# Webhook Output

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `webhook-output`
**Category:** output
**Credit cost:** `0` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `in`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `url: string`
- `params: WebhookParam[]`

**Optional data fields:**
- `credentialId?: string`
- `currentJobId?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `webhookSuccess?: boolean`
- `webhookStatusCode?: number`
- `webhookResponseBody?: string`

**Default data:**
```json
{
  "label": "Webhook Output",
  "url": "",
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
  "id": "webhook-output-1",
  "type": "webhook-output",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Webhook Output",
    "url": "",
    "params": []
  }
}
```
<!-- AUTO-GEN:END examples -->
