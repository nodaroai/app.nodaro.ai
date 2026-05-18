---
node_type: generate-image
generated_at: 2026-05-18T20:51:28.570Z
generated_from: af4193bd
---

# generate-image

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `generate-image`
**Category:** ai
**Credit cost:** 5
**Inputs (target handles):** `in`
**Outputs (source handles):** `image`

**Required data fields:**
- `label: string`
- `prompt: string`
- `provider: ImageProvider`
- `model: string`
- `style: string`
- `aspectRatio: string`
- `negativePrompt: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `providers?: readonly ImageProvider[]`
- `resolution?: string`
- `quality?: string`
- `seed?: number`
- `renderingSpeed?: string`
- `styleType?: string`
- `expandPrompt?: boolean`
- `referenceImageUrl?: string`
- `referenceImageUrls?: readonly ManualReferenceImage[]`
- `referenceImageOrder?: readonly string[]`
- `referenceOrder?: readonly string[]`
- `suppressedCanonicalCharacterIds?: readonly string[]`
- `suppressedCanonicalLocationIds?: readonly string[]`
- `identityMeta?: readonly IdentityMeta[]`
- `extraRefs?: readonly ExtraRef[]`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedImageUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `characterDefinitionIds?: readonly string[]`

**Default data:**
```json
{
  "label": "Generate Image",
  "prompt": "",
  "provider": "nano-banana-pro",
  "model": "gemini-2.5-flash-image",
  "style": "",
  "aspectRatio": "16:9",
  "negativePrompt": "",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `generate_image`

**Input parameters:**
- `prompt`
- `model`
- `resolution`
- `quality`
- `aspect_ratio`
- `negative_prompt`
- `structured`
<!-- AUTO-GEN:END mcp-call -->

## When to use

Text-to-image generation. For trailer / cinematic flows, embed character + location descriptions directly in the prompt rather than pre-generating separate character / location nodes (which would require types outside the strict 8-node whitelist).

## Common gotchas

- Field name is `generatedImageUrl` — NOT `imageUrl`, `outputUrl`, or `result.url`. The frontend reads only `generatedImageUrl` (or `generatedResults[].url`); anything else renders an empty placeholder.
- `executionStatus: "completed"` is REQUIRED for the node to mark itself complete and propagate downstream. The image itself will still render via the URL fallback chain (`activeResult?.url ?? generatedImageUrl ?? url`), but status badges, downstream wiring, and "run from here" will treat the node as incomplete without it.
- For 4K output, only `nano-banana-pro` currently supports it.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "generate-image-1",
  "type": "generate-image",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Generate Image",
    "prompt": "",
    "provider": "nano-banana-pro",
    "model": "gemini-2.5-flash-image",
    "style": "",
    "aspectRatio": "16:9",
    "negativePrompt": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
