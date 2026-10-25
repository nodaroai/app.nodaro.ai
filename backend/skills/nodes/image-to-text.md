---
node_type: image-to-text
generated_at: 2026-10-20T21:12:34.036Z
generated_from: 9ae3392be
---

# Describe Image

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `image-to-text`
**Category:** ai
**Credit cost:** `≈6` typical on Nodaro Cloud (an estimate on the default model: an LLM call is charged per token at its model's rate) — a call on any model is quoted by `GET /v1/credits/model-cost?model=image-to-text:<model id>` (MCP: `list_models` with `priceIds: ["image-to-text:<model id>"]`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `image`, `video`, `text`
**Outputs (source handles):** `text`

**Required data fields:**
- `label: string`
- `detailLevel: "brief" | "detailed" | "structured"`
- `customPrompt: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `promptPrefix?: string`
- `promptSuffix?: string`
- `llmModel?: string`
- `reasoningEffort?: LlmReasoningEffort`
- `advancedMode?: boolean`
- `temperature?: number`
- `maxTokens?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `currentJobProgress?: number`
- `errorMessage?: string`
- `generatedText?: string`
- `generatedResults?: Array<{ text: string; jobId: string; timestamp: string }>`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Describe Image",
  "detailLevel": "detailed",
  "customPrompt": "",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `image_to_text`

**Input parameters:**
- `image_url`
- `image_asset_id`
- `detail_level`
- `custom_prompt`
- `llmModel`
- `reasoning_effort`
- `advanced_mode`
- `temperature`
- `max_tokens`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "image-to-text-1",
  "type": "image-to-text",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Describe Image",
    "detailLevel": "detailed",
    "customPrompt": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
