# Edit Image
> Apply AI-powered image operations including upscaling, background removal, and context-aware editing to an existing image.

> **Note:** This page documents the `edit-image` API endpoint / legacy node. In the editor, this functionality has been split into dedicated nodes: **Upscale Image** (see [upscale-image.md](./upscale-image.md)), **Remove Background** (see [remove-background.md](./remove-background.md)), and **Modify Image** (see [modify-image.md](./modify-image.md)).

## Overview

Edit Image takes an existing image as input and applies a transformation operation. It supports AI upscaling (Recraft, Topaz, and Grok), background removal (Recraft), context-aware prompt-based editing (Nano Banana Edit), and the Grok Imagine 2 task-chained operations — a free segment map and region-targeted prompt edits of a prior Grok 2 generation (see [Grok Imagine 2 Task-Chained Editing](#grok-imagine-2-task-chained-editing)). Unlike Generate Image or Image to Image, this node focuses on non-destructive enhancement and utility operations rather than creative generation. The default operation is Recraft Upscale.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider / Operation | select | `recraft-upscale` | The edit operation to apply (5 options, see providers table) |
| Prompt | text | `""` | Edit instructions (only used by nano-banana-edit) |
| Style | select | `""` | Style preset or custom text (only used by nano-banana-edit) |
| Negative Prompt | text | `""` | Elements to exclude (only used by nano-banana-edit) |
| Upscale Factor | select | 2 | Topaz only: 1x, 2x, 4x |
| Aspect Ratio | select | -- | Available for nano-banana-edit |
| Seed | number | -- | Reproducibility seed (nano-banana-edit) |
| Connected Media Order | list | -- | Order of connected input media assets |

## Inputs & Outputs

**Inputs:**
- `image` -- source image from an upstream node (Upload Image, Generate Image, etc.)
- `mask` -- *optional* inpainting mask (white = edit, black = preserve). Forwarded to the provider as `mask_url`; only consumed by providers that support masks. Accepts a mask from a [Generate Mask](./generate-mask.md) node or any image URL whose pixels are black-and-white.

**Outputs:**
- `out` -- processed/edited image URL

## Inpainting Mask

Edit Image's backend forwards an attached mask to the provider as the `mask_url` parameter for workflow use -- wire the `mask` output of a [Generate Mask](./generate-mask.md) or hand-painted [Paint Mask](./paint-mask.md) node into this node's `mask` input, and the mask will be passed through at execution time.

The interactive **Mask Painter** UI (Paint Mask / Edit Mask buttons, brush/eraser/lasso tools, overlay/mask/source view toggle) currently lives in the **Modify Image** node when the **Ideogram Edit** provider is selected. White areas of the mask are re-rendered by the model; black areas are preserved untouched from the source image. Once a mask is saved on a Modify Image node, re-opening the painter pre-seeds the canvas with the existing mask so further edits build on prior work rather than starting blank.

## Supported Providers

| Provider | Label | Description |
|----------|-------|-------------|
| recraft-upscale | Recraft Upscale | AI-powered upscaling and enhancement. Simple one-click operation with no additional configuration. |
| topaz-image-upscale | Topaz Upscale | Advanced upscaling with a configurable factor (1x/2x/4x). |
| recraft-remove-bg | Recraft Remove BG | Removes the background and outputs a transparent PNG. No additional configuration needed. |
| nano-banana-edit | Nano Banana Edit | Context-aware image editing using a text prompt. Supports style presets, negative prompts, aspect ratio, seed, and character/asset references. |
| grok-upscale | Grok Upscale | AI upscaling via Grok. Takes a prior Grok generation's `taskId` instead of an image URL. |
| grok-2-edit | Grok Imagine 2 Edit | Prompt-based edit of a prior Grok 2 generation (`taskId` + `prompt` required). Optional `maskIndexes` restrict the edit to named regions from a segment map. Priced the same as a Grok 2 generation. |
| grok-2-segment | Grok Imagine 2 Segment Map | **Free.** Named segment-mask map of a prior Grok 2 generation (`taskId` required, no prompt). |

## Grok Imagine 2 Task-Chained Editing

The three `grok-*` operations don't take an image URL. They reference a **prior Grok generation on the provider side** via `taskId` — the task id is returned in the source generation job's output as `kieTaskId` (fetch the job via the API/SDK/MCP `get_job` and read `output_data.kieTaskId`). Only Grok generations can be chained; images from other providers or uploads cannot.

The full region-editing flow with `grok-2`:

1. **Generate** an image with the `grok-2` provider (Generate Image node or `POST /v1/generate-image`). Note the completed job's `kieTaskId`.
2. **Segment (optional, free)** — `POST /v1/edit-image` with `{ "provider": "grok-2-segment", "taskId": "<kieTaskId>" }`. `output_data.segments` lists `{ index, name }` pairs (e.g. `0 = sky`, `1 = person`), order-aligned with the job's output images — which are ~128×128 alpha-masked **cutouts** of each region (a bounding-box crop of the region's own pixels), *not* full-frame binary masks. Additionally pass `imageUrl` (the source generation's image) and each segment also gains a normalized `bbox: { x, y, w, h }` — its recovered position in the source image (Grok returns no geometry; the backend recovers it by template-matching the cutout against the source; absent when matching wasn't confident).
3. **Edit** — `POST /v1/edit-image` with `{ "provider": "grok-2-edit", "taskId": "<kieTaskId>", "prompt": "make the sky stormy", "maskIndexes": [0] }`. Omit `maskIndexes` to let the prompt apply to the whole image.

`maskIndexes` entries are the segment map's `index` values passed through **verbatim** (0-based in practice, whatever the segment map returned). A `grok-2-edit` run costs the same as a `grok-2` generation; the segment map costs nothing. Note the edit is region-*driven* rather than pixel-locked: Grok may adjust global lighting to keep the scene consistent (e.g. a night-sky edit also relights the water).

In the editor, this flow is built into the **Generate Image** node: with the grok-2 provider selected, its config panel shows a **Refine Regions** section (detect regions → tick named chips → prompt edit) — see [Generate Image → Refine regions](./generate-image.md#refine-regions-grok-imagine-2). The API/MCP flow above is the same machinery.

## Best Practices

- Use Recraft Upscale for quick, low-cost enhancement when precise resolution control is not needed.
- Use Topaz Upscale for production-quality upscaling at 2x or 4x.
- Recraft Remove BG outputs transparent PNGs suitable for compositing workflows.
- Nano Banana Edit and Grok Imagine 2 Edit are the Edit Image operations that accept a text prompt -- use them for targeted modifications (e.g., "change the sky to sunset", "add a hat to the person").
- Chain Edit Image nodes for multi-step operations: remove background first, then upscale.

## Common Use Cases

- Upscaling AI-generated images to print-resolution quality.
- Removing backgrounds for product photos or compositing layers.
- Making targeted edits to specific regions of generated images via prompt instructions.
- Preparing assets for video compositions that require higher resolution inputs.
- Quick enhancement of uploaded photos before feeding into other AI nodes.

## Tips

- Background removal results are best when the subject has clear edges against the background. Complex scenes with hair or transparent objects may require manual cleanup.
- For Nano Banana Edit, write specific edit instructions rather than describing the full scene. For example, prefer "make the sky purple" over "a landscape with a purple sky".
