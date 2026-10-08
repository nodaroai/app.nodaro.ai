---
node_type: generate-image
generated_at: 2026-10-08T13:32:41.474Z
generated_from: c20219700
---

# generate-image

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `generate-image`
**Category:** ai
**Credit cost:** `2-620` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `prompt`, `negative`, `references`, `assets`, `elements`, `look`, `settings`
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
- `promptPrefix?: string`
- `promptSuffix?: string`
- `providers?: readonly ImageProvider[]`
- `resolution?: string`
- `quality?: string`
- `seed?: number`
- `renderingSpeed?: string`
- `styleType?: string`
- `expandPrompt?: boolean`
- `referenceImageUrl?: string`
- `referenceImageUrls?: readonly ManualReferenceImage[]`
- `baseImageUrl?: string`
- `maskUrl?: string`
- `strength?: number`
- `guidanceScale?: number`
- `grokSegments?: {
    readonly taskId: string
    readonly segments: readonly GrokSegmentInfo[]
  }`
- `grokSelectedSegments?: readonly number[]`
- `grokRegionPrompt?: string`
- `referenceImageOrder?: readonly string[]`
- `referenceOrder?: readonly string[]`
- `suppressedCanonicalCharacterIds?: readonly string[]`
- `suppressedCanonicalLocationIds?: readonly string[]`
- `identityMeta?: readonly IdentityMeta[]`
- `direction?: DirectionFields`
- `structured?: StructuredPromptFields`
- `extraRefs?: readonly ExtraRef[]`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `errorHint?: JobErrorHint`
- `jobAwaitingReview?: boolean`
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
  "provider": "gpt-image-2",
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
- `presetId`
- `model`
- `resolution`
- `quality`
- `aspect_ratio`
- `negative_prompt`
- `reference_image_urls`
- `base_image_url`
- `mask_url`
- `strength`
- `guidance_scale`
- `structured`
- `connected_references`
- `described_references`
- `reference_order`
<!-- AUTO-GEN:END mcp-call -->

## When to use

Text-to-image generation. For trailer / cinematic flows, embed character + location descriptions directly in the prompt rather than pre-generating separate character / location nodes (which would require types outside the strict 8-node whitelist).

### Quick model picks (MCP `generate_image`)

- `gpt-image-2` (default) — best overall in the 2026-10 comparison: characters and identity from reference images, character boards and grids, exact text and non-Latin lettering. It draws 1:1, 16:9, 9:16, 4:3 and 3:4.
- `gpt-image-2-5-sunburst` — the same family for ratios GPT Image 2 can't draw (21:9, 3:2, 2:3); `gpt-image-2-5-flare` is its faster sibling.
- `nano-banana-2-1` — strong scenes and illustration for a lower price; good for drafts and iteration.
- `z-image` — cheapest stylized output.
- **Avoid `flux`** for general use — it degrades in multi-turn workflows; use one of the above.

Aspect ratios are model-specific: for 21:9 use a model whose `aspectRatios` includes it (GPT Image 2.5, the Nano Banana family, Seedream). Pass `reference_image_urls` (up to 14 URLs or Nodaro asset ids) for "the same person / character / product as this image" — identity, style and composition guidance; the tool's response text confirms how many references attached, and if it does not mention them they did not make it.

## Common gotchas

- Field name is `generatedImageUrl` — NOT `imageUrl`, `outputUrl`, or `result.url`. The frontend reads only `generatedImageUrl` (or `generatedResults[].url`); anything else renders an empty placeholder.
- `executionStatus: "completed"` is REQUIRED for the node to mark itself complete and propagate downstream. The image itself will still render via the URL fallback chain (`activeResult?.url ?? generatedImageUrl ?? url`), but status badges, downstream wiring, and "run from here" will treat the node as incomplete without it.
- For 4K output, only `nano-banana-pro` currently supports it.
- The `settings` input takes Aspect Ratio and Provider nodes (one input for all). Each wired value replaces the node's own `aspectRatio` or `provider` at run time, fitted to the model; a wired Provider also replaces `providers` (the node runs only that model, once) and must name an image model, or the run stops before anything is charged.

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
    "provider": "gpt-image-2",
    "style": "",
    "aspectRatio": "16:9",
    "negativePrompt": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->

<!-- AUTO-GEN:START image-reference-prompting -->
## Reference-image prompting ({image:N:label} tokens)

The `references` handle takes MULTIPLE image producers (upload-image, generate-image, …) wired into one generate-image node. Connection order is the numbering: the first-connected reference is 1. The prompt then binds them with tokens:

- `{image:N:label}` → expands server-side to `Image N (label)`, aligned with the numbered reference list sent to the provider.
- `{image:N}` → `Image N` (no role named).
- A token whose N has no wired reference falls back to its label (`{image:3:dog}` → `dog`); a bare `{image:N}` is dropped. The prompt still runs but binds nothing at N, so check the numbering against what is wired.

**How to compose**
- The prompt should be little more than tokens plus glue words: `{image:1:person} with {image:2:face}`. The label tells the model what to TAKE from that image — `person`, `face`, `background`, `settings`, or a concrete garment/prop name (`jacket`).
- Order = priority. Put the identity-critical image first. Swapping the numbers (or the labels) swaps the result — `{image:2:person} with {image:1:face}` transplants in the opposite direction.
- Do NOT re-describe what a referenced image already shows; a sentence fighting the reference degrades adherence. Add only what is NEW (pose, lighting, scene) — or better, reference it from another image.

**Core patterns (each is one generate-image node with two wired references)**
- Identity transplant: `{image:1:person} with {image:2:face}` — body/outfit/scene from 1, face from 2.
- Reverse transplant: `{image:2:person} with {image:1:face}` — same two references, opposite result.
- Keep the stage, change the star: `{image:1:background} with {image:2:person}`.
- Relocation: `{image:1:person} in {image:2:settings}`.
- Garment transfer: `{image:1:person} Wearing {image:2:jacket} on top, at {image:2:settings}` — several labels can pull different things from the SAME image.

**Providers & settings**
- Multi-reference composition is strongest on the GPT-Image family (`gpt-image-2`) and the Nano Banana family (`nano-banana-pro`). Check a model's reference support via `list_models` before relying on more than one reference.
- Set an explicit `aspectRatio` and prefer `resolution: "2K"` for composites — face detail survives the merge better.

**Known pitfall**
- Person+face composition intermittently trips provider content filters ("Content policy violation"). Keep wording neutral (no glamor/body emphasis), and on a rejection rephrase the glue words or swap provider rather than retrying unchanged.

_Generated from `IMAGE_REFERENCE_PROMPT_DOCTRINE` in `@nodaro/prompts` — edit there, then `npm run gen:skills`._
<!-- AUTO-GEN:END image-reference-prompting -->
