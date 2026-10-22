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
**Credit cost:** charged for the tokens the call used, at the chosen model's rate (`docs/pricing/llm-models.md`) — the estimate for a model is `GET /v1/credits/model-cost?model=ai-writer:<model>` (an `estimate: true` answer; MCP: `list_models`).
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

> **This block is frozen, and hand-maintained below.** `ai-writer` no longer
> appears in `NODE_DEFINITIONS` (the editor migrates it to `llm-chat`), so
> `gen:skills` cannot regenerate this file — it was last generated 2026-05-18
> and the generator silently skips it. The `/v1/ai-writer` route is still live
> and has gained fields since. Anything below this line is maintained by hand.

**Additional accepted fields** (present on the route, absent from the frozen
block above):

- `llmModel?: string` — any id from the LLM model registry.
- `reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | "max"` —
  clamped to what the chosen model declares. A higher effort costs more only
  through the tokens it writes; on a Claude model any effort runs on Anthropic's
  own API, at that lane's rate.
- `advancedMode?: boolean` — Gemini models only. Runs the request on the
  provider's own API so `temperature` / `maxTokens` / the full reasoning range
  actually apply, charged at that lane's rate. Sending it with a non-Gemini model
  returns `400 advanced_mode_unsupported`.

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
