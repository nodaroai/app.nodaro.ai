---
node_type: paint-mask
generated_at: 2026-10-14T00:02:37.023Z
generated_from: b83a9467d
---

# Paint Mask

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `paint-mask`
**Category:** processing
**Credit cost:** `0` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `image`, `mask`
**Outputs (source handles):** `mask`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `maskUrl?: string`
- `sourceImageUrl?: string`
- `maskUpdatedAt?: number`
- `defaultBrushSize?: number`
- `defaultBrushHardness?: number`

**Default data:**
```json
{
  "label": "Paint Mask",
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
  "id": "paint-mask-1",
  "type": "paint-mask",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Paint Mask",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
