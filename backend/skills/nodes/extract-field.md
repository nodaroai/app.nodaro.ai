---
node_type: extract-field
generated_at: 2026-10-14T00:02:38.042Z
generated_from: b83a9467d
---

# Extract Field

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `extract-field`
**Category:** utility
**Credit cost:** `0` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `in`
**Outputs (source handles):** `text`

**Required data fields:**
- `label: string`
- `mode: "dropdown" | "custom"`
- `field: string`

**Optional data fields:**
- `outputType?: "text" | "list" | "json"`
- `extractedText?: string`
- `generatedJson?: unknown`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`

**Default data:**
```json
{
  "label": "Extract Field",
  "mode": "dropdown",
  "field": ""
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
  "id": "extract-field-1",
  "type": "extract-field",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Extract Field",
    "mode": "dropdown",
    "field": ""
  }
}
```
<!-- AUTO-GEN:END examples -->
