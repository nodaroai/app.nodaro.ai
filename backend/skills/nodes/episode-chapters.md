---
node_type: episode-chapters
generated_at: 2026-10-19T15:56:14.658Z
generated_from: e04b2b33b
---

# Chapters

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `episode-chapters`
**Category:** processing
**Credit cost:** `per-minute` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `media`
**Outputs (source handles):** `text`, `json`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `mediaOrder?: string[]`
- `planTier?: "economy" | "standard" | "premium"`
- `instructions?: string`
- `styleGuide?: string`
- `useCaseJobId?: string`
- `useCaseExecutionId?: string`
- `generatedText?: string`
- `generatedJson?: unknown`
- `generatedTranscript?: unknown`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "Chapters",
  "planTier": "economy",
  "instructions": "",
  "styleGuide": "",
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
  "id": "episode-chapters-1",
  "type": "episode-chapters",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Chapters",
    "planTier": "economy",
    "instructions": "",
    "styleGuide": "",
    "fieldMappings": {},
    "executionStatus": "idle"
  }
}
```
<!-- AUTO-GEN:END examples -->
