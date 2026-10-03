---
node_type: telegram-trigger
generated_at: 2026-09-27T12:51:25.659Z
generated_from: c607aa02c
---

# Telegram Trigger

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `telegram-trigger`
**Category:** input
**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`).
**Inputs (target handles):** (none)
**Outputs (source handles):** `text`, `imageUrl`, `videoUrl`, `audioUrl`, `chatId`, `messageId`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `connectionId?: string`
- `chatIdFilter?: string`
- `messageTypeFilters?: string[]`
- `triggerId?: string`
- `isActive?: boolean`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`

**Default data:**
```json
{
  "label": "Telegram Trigger",
  "messageTypeFilters": [
    "text",
    "photo",
    "video",
    "audio",
    "document"
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
  "id": "telegram-trigger-1",
  "type": "telegram-trigger",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Telegram Trigger",
    "messageTypeFilters": [
      "text",
      "photo",
      "video",
      "audio",
      "document"
    ]
  }
}
```
<!-- AUTO-GEN:END examples -->
