---
node_type: qa-check
generated_at: 2026-08-15T21:55:06.768Z
generated_from: 150c80ac9
---

# QA Check

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `qa-check`
**Category:** ai
**Credit cost:** 1
**Inputs (target handles):** `in`
**Outputs (source handles):** `approved`, `rejected`

**Required data fields:**
- `label: string`
- `provider: QaCheckProvider`
- `checkType: "content" | "quality" | "consistency" | "safety"`
- `threshold: number`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `llmModel?: string`
- `reasoningEffort?: LlmReasoningEffort`
- `advancedMode?: boolean`
- `temperature?: number`
- `maxTokens?: number`
- `currentJobId?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `score?: number`
- `approved?: boolean`
- `reason?: string`

**Default data:**
```json
{
  "label": "QA Check",
  "provider": "claude",
  "checkType": "quality",
  "threshold": 0.8,
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
  "id": "qa-check-1",
  "type": "qa-check",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "QA Check",
    "provider": "claude",
    "checkType": "quality",
    "threshold": 0.8,
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
