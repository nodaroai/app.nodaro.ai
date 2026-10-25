---
node_type: motion-graphics
generated_at: 2026-10-20T21:12:34.734Z
generated_from: 9ae3392be
---

# Motion Graphics

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `motion-graphics`
**Category:** ai
**Credit cost:** `≈6` typical on Nodaro Cloud (an estimate on the default model: an LLM call is charged per token at its model's rate) — a call on any model is quoted by `GET /v1/credits/model-cost?model=motion-graphics:<model id>` (MCP: `list_models` with `priceIds: ["motion-graphics:<model id>"]`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `video`
**Outputs (source handles):** `composition`, `lottie`

**Required data fields:**
- `label: string`
- `motionPrompt: string`
- `aspectRatio: "16:9" | "9:16" | "1:1" | "4:5"`
- `backgroundColor: string`
- `fps: number`
- `durationSeconds: number`

**Optional data fields:**
- `promptPrefix?: string`
- `promptSuffix?: string`
- `motionPlan?: Record<string, unknown>`
- `engine?: "elements" | "lottie"`
- `lottieUrl?: string`
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
  "label": "Motion Graphics",
  "motionPrompt": "",
  "engine": "lottie",
  "aspectRatio": "16:9",
  "backgroundColor": "#00000000",
  "fps": 30,
  "durationSeconds": 5,
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
  "id": "motion-graphics-1",
  "type": "motion-graphics",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Motion Graphics",
    "motionPrompt": "",
    "engine": "lottie",
    "aspectRatio": "16:9",
    "backgroundColor": "#00000000",
    "fps": 30,
    "durationSeconds": 5,
    "fieldMappings": {},
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
