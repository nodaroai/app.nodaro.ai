---
node_type: ugc-cards
generated_at: 2026-10-14T00:02:34.560Z
generated_from: b83a9467d
---

# UGC Cards

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `ugc-cards`
**Category:** ai
**Credit cost:** `0` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `plan`, `video`, `transcript`, `notes`
**Outputs (source handles):** `layerPlan`, `captionPlan`, `report`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `result?: { layerPlan: string; captionPlan: string; report: string }`
- `ugcOutputs?: Record<string, string>`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "UGC Cards",
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
  "id": "ugc-cards-1",
  "type": "ugc-cards",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "UGC Cards",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
