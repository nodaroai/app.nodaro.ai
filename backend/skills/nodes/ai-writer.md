---
node_type: ai-writer
generated_at: 2026-05-18T13:23:37.753Z
generated_from: cb1e786d
---

# AI Agent

> **Deprecated node type.** `ai-writer` is a legacy type — the editor auto-migrates
> it to `llm-chat` on workflow load. The backend still executes `ai-writer` for
> in-flight / server-side runs, so this skill is kept for `get_node_skill("ai-writer")`.
> For new workflows use `llm-chat` (chat/completion) or `generate-script` (multi-prompt).

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `ai-writer`
**Category:** ai
**Credit cost:** 3
**Inputs (target handles):** `in`
**Outputs (source handles):** `text`

**Default data:**
```json
{
  "label": "AI Agent",
  "templateId": "custom",
  "systemPrompt": "",
  "userInput": "",
  "temperature": 0.7,
  "maxTokens": 4096,
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
  "id": "ai-writer-1",
  "type": "ai-writer",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "AI Agent",
    "templateId": "custom",
    "systemPrompt": "",
    "userInput": "",
    "temperature": 0.7,
    "maxTokens": 4096,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
