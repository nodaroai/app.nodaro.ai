---
node_type: after-effects
generated_at: 2026-10-14T00:02:35.774Z
generated_from: b83a9467d
---

# After Effects

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `after-effects`
**Category:** processing
**Credit cost:** `11-55` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `video`
**Outputs (source handles):** `composition`

**Required data fields:**
- `label: string`
- `effectPrompt: string`
- `fps: number`
- `durationSeconds: number`

**Optional data fields:**
- `effectPlan?: Record<string, unknown>`
- `inputVideoUrl?: string`
- `width?: number`
- `height?: number`
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
  "label": "After Effects",
  "effectPrompt": "",
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
  "id": "after-effects-1",
  "type": "after-effects",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "After Effects",
    "effectPrompt": "",
    "fps": 30,
    "durationSeconds": 10,
    "fieldMappings": {},
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
