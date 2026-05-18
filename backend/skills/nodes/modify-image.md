---
node_type: modify-image
generated_at: 2026-05-18T13:23:37.328Z
generated_from: cb1e786d
---

# Modify Image

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `modify-image`
**Category:** ai
**Credit cost:** 2
**Inputs (target handles):** `image`
**Outputs (source handles):** `out`

**Required data fields:**
- `label: string`
- `prompt: string`
- `provider: ModifyImageProvider`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `style?: string`
- `strength?: number`
- `aspectRatio?: string`
- `resolution?: string`
- `quality?: string`
- `negativePrompt?: string`
- `seed?: number`
- `renderingSpeed?: string`
- `guidanceScale?: number`
- `referenceImageUrl?: string`
- `maskUrl?: string`
- `characterDefinitionIds?: readonly string[]`
- `connectedMediaOrder?: readonly string[]`
- `referenceOrder?: readonly string[]`
- `suppressedCanonicalCharacterIds?: readonly string[]`
- `extraRefs?: readonly ExtraRef[]`
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
  "label": "Modify Image",
  "prompt": "",
  "provider": "nano-banana",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

(Add prose here. Auto-gen will preserve it across regenerations.)

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `modify_image`

**Input parameters:**
- `prompt`
- `image_url`
- `image_asset_id`
- `model`
- `resolution`
- `quality`
- `aspect_ratio`
- `negative_prompt`
- `structured`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

(Add prose here.)

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "modify-image-1",
  "type": "modify-image",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Modify Image",
    "prompt": "",
    "provider": "nano-banana",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
