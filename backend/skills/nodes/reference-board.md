---
node_type: reference-board
generated_at: 2026-09-27T12:51:25.219Z
generated_from: c607aa02c
---

# Reference Board

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `reference-board`
**Category:** ai
**Credit cost:** `15-60` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `prompt`, `references`
**Outputs (source handles):** `image`

**Required data fields:**
- `label: string`
- `sourceMode: "entity" | "image"`
- `boardTemplate: string`
- `provider: ImageProvider`
- `prompt: string`
- `negativePrompt: string`
- `aspectRatio: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `resolution?: string`
- `quality?: string`
- `seed?: number`
- `referenceImageUrls?: readonly ManualReferenceImage[]`
- `referenceImageOrder?: readonly string[]`
- `generatedResults?: GenerateImageData["generatedResults"]`
- `activeResultIndex?: number`
- `generatedImageUrl?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `executionStatus?: GenerateImageData["executionStatus"]`
- `errorMessage?: string`

**Default data:**
```json
{
  "label": "Reference Board",
  "sourceMode": "image",
  "boardTemplate": "character/full-board",
  "provider": "nano-banana-pro",
  "prompt": "",
  "negativePrompt": "",
  "aspectRatio": "2:3",
  "resolution": "4K",
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
  "id": "reference-board-1",
  "type": "reference-board",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Reference Board",
    "sourceMode": "image",
    "boardTemplate": "character/full-board",
    "provider": "nano-banana-pro",
    "prompt": "",
    "negativePrompt": "",
    "aspectRatio": "2:3",
    "resolution": "4K",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
