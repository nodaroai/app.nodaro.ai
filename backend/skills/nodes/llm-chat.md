---
node_type: llm-chat
generated_at: 2026-09-27T12:51:24.962Z
generated_from: c607aa02c
---

# LLM Chat

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `llm-chat`
**Category:** ai
**Credit cost:** `1-6` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `prompt`, `references`, `system-prompt`
**Outputs (source handles):** `text`, `items`

**Required data fields:**
- `label: string`
- `systemPrompt: string`
- `userInput: string`
- `temperature: number`
- `maxTokens: number`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `promptPrefix?: string`
- `promptSuffix?: string`
- `llmModel?: string`
- `reasoningEffort?: LlmReasoningEffort`
- `advancedMode?: boolean`
- `repeatCount?: number`
- `templateId?: string`
- `generatedItems?: string[]`
- `createdNodeIds?: string[]`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedText?: string`
- `generatedResults?: Array<{ text: string; jobId?: string; timestamp?: string; systemPrompt?: string; userPrompt?: string; listValue?: string; runId?: string; model?: string; templateId?: string }>`
- `activeResultIndex?: number`
- `lastSystemPrompt?: string`
- `lastUserPrompt?: string`
- `referenceImageUrls?: readonly string[]`
- `referenceVideoUrls?: readonly string[]`
- `referenceAudioUrls?: readonly string[]`

**Default data:**
```json
{
  "label": "Prompt",
  "systemPrompt": "",
  "userInput": "",
  "temperature": 0.7,
  "maxTokens": 8192,
  "fieldMappings": {},
  "templateId": "custom"
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
  "id": "llm-chat-1",
  "type": "llm-chat",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Prompt",
    "systemPrompt": "",
    "userInput": "",
    "temperature": 0.7,
    "maxTokens": 8192,
    "fieldMappings": {},
    "templateId": "custom"
  }
}
```
<!-- AUTO-GEN:END examples -->
