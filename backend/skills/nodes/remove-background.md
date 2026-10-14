---
node_type: remove-background
generated_at: 2026-10-14T06:31:29.729Z
generated_from: 0c2e65dcc
---

# Remove Background

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `remove-background`
**Category:** ai
**Credit cost:** `4` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `image`
**Outputs (source handles):** `image`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedImageUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "Remove Background",
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
  "id": "remove-background-1",
  "type": "remove-background",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Remove Background",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
