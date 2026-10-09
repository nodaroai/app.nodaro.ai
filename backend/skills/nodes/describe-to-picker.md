---
node_type: describe-to-picker
generated_at: 2026-10-09T09:26:17.492Z
generated_from: e7df15b61
---

# Describe to Picker

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `describe-to-picker`
**Category:** ai
**Credit cost:** `10-25` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `image`
**Outputs (source handles):** `picker-json`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `llmModel?: string`
- `reasoningEffort?: LlmReasoningEffort`
- `advancedMode?: boolean`
- `temperature?: number`
- `maxTokens?: number`
- `instructions?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `currentJobProgress?: number`
- `errorMessage?: string`
- `generatedPickerJson?: Record<string, unknown>`
- `generatedPickerRunId?: string`
- `generatedGaps?: PickerGaps`

**Default data:**
```json
{
  "label": "Describe to Picker"
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
  "id": "describe-to-picker-1",
  "type": "describe-to-picker",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Describe to Picker"
  }
}
```
<!-- AUTO-GEN:END examples -->
