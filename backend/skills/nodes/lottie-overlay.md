---
node_type: lottie-overlay
generated_at: 2026-10-20T21:12:34.657Z
generated_from: 9ae3392be
---

# Lottie Overlay

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `lottie-overlay`
**Category:** processing
**Credit cost:** `~6` typical on Nodaro Cloud (an estimate on the default model: an LLM call is charged per token at its model's rate) — a call on any model is quoted by `GET /v1/credits/model-cost?model=lottie-overlay:<model id>` (MCP: `list_models` with `priceIds: ["lottie-overlay:<model id>"]`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `video`, `lottie`
**Outputs (source handles):** `composition`

**Required data fields:**
- `label: string`
- `overlayPrompt: string`
- `fps: number`
- `durationSeconds: number`

**Optional data fields:**
- `overlayPlan?: Record<string, unknown>`
- `inputVideoUrl?: string`
- `width?: number`
- `height?: number`
- `lottieAssets?: Array<{ id: string; url: string; name: string; durationSeconds?: number }>`
- `llmModel?: string`
- `reasoningEffort?: LlmReasoningEffort`
- `advancedMode?: boolean`
- `temperature?: number`
- `maxTokens?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `currentJobProgress?: number`
- `errorMessage?: string`

**Default data:**
```json
{
  "label": "Lottie Overlay",
  "overlayPrompt": "",
  "fps": 30,
  "durationSeconds": 10,
  "fieldMappings": {},
  "executionStatus": "idle"
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
  "id": "lottie-overlay-1",
  "type": "lottie-overlay",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Lottie Overlay",
    "overlayPrompt": "",
    "fps": 30,
    "durationSeconds": 10,
    "fieldMappings": {},
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
