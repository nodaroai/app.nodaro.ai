---
node_type: telegram-account-trigger
generated_at: 2026-10-02T00:36:40.522Z
generated_from: 5f14bf98e
---

# Telegram Account Trigger

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `telegram-account-trigger`
**Category:** input
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** (none)
**Outputs (source handles):** `out`, `videoLink`, `postText`, `postLink`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `accountId?: string`
- `chatIds?: string[]`
- `chatTitles?: Record<string, string>`
- `messageTypeFilters?: string[]`
- `keywords?: string[]`
- `includeOutgoing?: boolean`
- `inboxMode?: boolean`
- `isActive?: boolean`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`

**Default data:**
```json
{
  "label": "Telegram Account Trigger",
  "chatIds": [],
  "messageTypeFilters": [],
  "keywords": [],
  "includeOutgoing": false,
  "inboxMode": false,
  "isActive": false
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
  "id": "telegram-account-trigger-1",
  "type": "telegram-account-trigger",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Telegram Account Trigger",
    "chatIds": [],
    "messageTypeFilters": [],
    "keywords": [],
    "includeOutgoing": false,
    "inboxMode": false,
    "isActive": false
  }
}
```
<!-- AUTO-GEN:END examples -->
