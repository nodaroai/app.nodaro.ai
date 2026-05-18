---
node_type: generate-mask
generated_at: 2026-05-18T13:23:37.700Z
generated_from: cb1e786d
---

# Generate Mask

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `generate-mask`
**Category:** ai
**Credit cost:** 2
**Inputs (target handles):** `image`
**Outputs (source handles):** `image`, `mask`

**Required data fields:**
- `label: string`
- `prompt: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `threshold?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedMaskUrl?: string`
- `generatedImageUrl?: string`
- `generatedResults?: Array<{ imageUrl: string; maskUrl: string }>`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "Generate Mask",
  "prompt": "",
  "threshold": 0.3,
  "fieldMappings": {},
  "executionStatus": "idle",
  "generatedResults": [],
  "activeResultIndex": 0
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `generate_mask`

**Input parameters:**
- `image_url`
- `image_asset_id`
- `prompt`
- `threshold`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "generate-mask-1",
  "type": "generate-mask",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Generate Mask",
    "prompt": "",
    "threshold": 0.3,
    "fieldMappings": {},
    "executionStatus": "idle",
    "generatedResults": [],
    "activeResultIndex": 0
  }
}
```
<!-- AUTO-GEN:END examples -->
