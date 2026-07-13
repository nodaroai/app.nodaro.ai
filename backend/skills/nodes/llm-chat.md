---
node_type: llm-chat
generated_at: 2026-07-13T16:15:38.348Z
generated_from: 9af14ef89
---

# LLM Chat

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `llm-chat`
**Category:** ai
**Credit cost:** 3
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
- `llmModel?: string`
- `reasoningEffort?: LlmReasoningEffort`
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
  "label": "Generate Text",
  "systemPrompt": "",
  "userInput": "",
  "temperature": 0.7,
  "maxTokens": 2048,
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
    "label": "Generate Text",
    "systemPrompt": "",
    "userInput": "",
    "temperature": 0.7,
    "maxTokens": 2048,
    "fieldMappings": {},
    "templateId": "custom"
  }
}
```
<!-- AUTO-GEN:END examples -->
