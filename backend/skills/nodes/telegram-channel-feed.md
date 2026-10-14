---
node_type: telegram-channel-feed
generated_at: 2026-10-14T00:02:40.526Z
generated_from: b83a9467d
---

# Telegram Channel Feed

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `telegram-channel-feed`
**Category:** input
**Credit cost:** `11` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** (none)
**Outputs (source handles):** `json`, `text`

**Required data fields:**
- `label: string`
- `channel: string`

**Optional data fields:**
- `limit?: number`
- `lastSeenId?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedText?: string`
- `generatedJson?: TelegramChannelPost[]`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "Telegram Channel Feed",
  "channel": "",
  "limit": 5
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
  "id": "telegram-channel-feed-1",
  "type": "telegram-channel-feed",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Telegram Channel Feed",
    "channel": "",
    "limit": 5
  }
}
```
<!-- AUTO-GEN:END examples -->
