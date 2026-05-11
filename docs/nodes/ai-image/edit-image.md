# Edit Image
> Apply AI-powered image operations including upscaling, background removal, and context-aware editing to an existing image.

## Overview

Edit Image takes an existing image as input and applies a transformation operation. It supports five operations: AI upscaling (Recraft, Topaz, and Grok), background removal (Recraft), and context-aware prompt-based editing (Nano Banana Edit). Unlike Generate Image or Image to Image, this node focuses on non-destructive enhancement and utility operations rather than creative generation. The default operation is Recraft Upscale.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider / Operation | select | `recraft-upscale` | The edit operation to apply (5 options, see providers table) |
| Prompt | text | `""` | Edit instructions (only used by nano-banana-edit) |
| Style | select | `""` | Style preset or custom text (only used by nano-banana-edit) |
| Negative Prompt | text | `""` | Elements to exclude (only used by nano-banana-edit) |
| Upscale Factor | select | -- | Topaz only: 1x, 2x, 4x, 8x |
| Target Resolution | select | -- | Topaz only: 2K, 4K, 8K |
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

Edit Image's backend forwards an attached mask to the provider as the `mask_url` parameter for workflow use -- wire the `mask` output of a [Generate Mask](./generate-mask.md) node into this node's `mask` input, and the mask will be passed through at execution time.

The interactive **Mask Painter** UI (Paint Mask / Edit Mask buttons, brush/eraser/lasso tools, overlay/mask/source view toggle) currently lives in the **Modify Image** node when the **Ideogram Edit** provider is selected. White areas of the mask are re-rendered by the model; black areas are preserved untouched from the source image. Once a mask is saved on a Modify Image node, re-opening the painter pre-seeds the canvas with the existing mask so further edits build on prior work rather than starting blank.

## Supported Providers

| Provider | Label | Description |
|----------|-------|-------------|
| recraft-upscale | Recraft Upscale | AI-powered upscaling and enhancement. Simple one-click operation with no additional configuration. |
| topaz-image-upscale | Topaz Upscale | Advanced upscaling with configurable factor (1x/2x/4x/8x) and target resolution (2K/4K/8K). |
| recraft-remove-bg | Recraft Remove BG | Removes the background and outputs a transparent PNG. No additional configuration needed. |
| nano-banana-edit | Nano Banana Edit | Context-aware image editing using a text prompt. Supports style presets, negative prompts, aspect ratio, seed, and character/asset references. |
| grok-upscale | Grok Upscale | AI upscaling via Grok. |

## Best Practices

- Use Recraft Upscale for quick, low-cost enhancement when precise resolution control is not needed.
- Use Topaz Upscale for production-quality upscaling where you need to target a specific resolution (2K/4K/8K).
- Recraft Remove BG outputs transparent PNGs suitable for compositing workflows.
- Nano Banana Edit is the only Edit Image operation that accepts a text prompt -- use it for targeted modifications (e.g., "change the sky to sunset", "add a hat to the person").
- Chain Edit Image nodes for multi-step operations: remove background first, then upscale.

## Common Use Cases

- Upscaling AI-generated images to print-resolution quality.
- Removing backgrounds for product photos or compositing layers.
- Making targeted edits to specific regions of generated images via prompt instructions.
- Preparing assets for video compositions that require higher resolution inputs.
- Quick enhancement of uploaded photos before feeding into other AI nodes.

## Tips

- Topaz upscale factor and target resolution are independent settings. The factor controls the scaling multiplier while target resolution caps the output size.
- Background removal results are best when the subject has clear edges against the background. Complex scenes with hair or transparent objects may require manual cleanup.
- For Nano Banana Edit, write specific edit instructions rather than describing the full scene. For example, prefer "make the sky purple" over "a landscape with a purple sky".
