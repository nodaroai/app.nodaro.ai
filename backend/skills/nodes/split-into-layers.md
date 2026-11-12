---
node_type: split-into-layers
generated_at: 2026-11-11T19:47:32.496Z
generated_from: 223a60d37
---

# Split into Layers

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `split-into-layers`
**Category:** ai
**Credit cost:** `104` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `image`
**Outputs (source handles):** `base`, `layers`, `layerData`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `maxLayers?: number`
- `size?: "1K" | "1.5K" | "2K" | "auto"`
- `prompt?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobProgress?: number`
- `currentJobId?: string`
- `imageUrl?: string`
- `generatedImageUrl?: string`
- `generatedLayerUrls?: string[] | null`
- `generatedLayerData?: SplitLayer[] | null`
- `layersNotSaved?: number | null`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Split into Layers",
  "maxLayers": 9,
  "size": "1K",
  "prompt": "",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `split_into_layers`

**Input parameters:**
- `image_url`
- `image_asset_id`
- `max_layers`
- `size`
- `prompt`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "split-into-layers-1",
  "type": "split-into-layers",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Split into Layers",
    "maxLayers": 9,
    "size": "1K",
    "prompt": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
