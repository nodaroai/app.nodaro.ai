---
node_type: telegram-channel-feed
generated_at: 2026-08-15T21:55:10.075Z
generated_from: 150c80ac9
---

# Telegram Channel Feed

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `telegram-channel-feed`
**Category:** input
**Credit cost:** 1
**Inputs (target handles):** (none)
**Outputs (source handles):** `text`

**Required data fields:**
- `label: string`
- `channel: string`

**Optional data fields:**
- `limit?: number`
- `lastSeenId?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedText?: string`
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
