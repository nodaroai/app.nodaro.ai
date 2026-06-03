# Image to Image
> Transform an existing image using AI with a text prompt, preserving structure while applying new styles, subjects, or modifications.

## Overview

Image to Image takes a source image and a text prompt to generate a transformed version. Unlike Edit Image (which focuses on utility operations like upscaling), Image to Image performs creative transformations: restyling, subject replacement, inpainting, reframing, and remix operations. It supports 15 provider models with varying capabilities including strength control, mask-based inpainting, guidance scale, and resolution options. The default provider is Nano Banana.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | select | `nano-banana` | AI model to use for transformation (15 options) |
| Prompt | text | `""` | Description of the desired transformation |
| Style | select | `""` | 16 presets + "Custom..." free text (same as Generate Image) |
| Negative Prompt | text | `""` | Elements to exclude from the result |
| Strength | slider (0-1) | varies | How much to deviate from the source image. Higher values mean more change. Only available for providers that support it. |
| Guidance Scale | number | varies | Prompt adherence strength. Only available for providers that support it. |
| Aspect Ratio | select | varies | Provider-specific ratio sets (same sets as Generate Image) |
| Resolution | select | varies | Available for flux-i2i, flux-pro-i2i: 1K, 2K |
| Quality | select | varies | Available for gpt-image-i2i (medium/high), seedream-edit (basic/high), seedream-5-lite-i2i (basic/high) |
| Rendering Speed | select | -- | Available for ideogram variants: turbo, balanced, quality |
| Seed | number | -- | Reproducibility seed (select providers) |
| Mask | image/canvas | -- | Inpainting mask (ideogram-edit only). Painted via a mask editor modal. |
| Reference Image | image | -- | Additional reference for style guidance |

## Inputs & Outputs

**Inputs:**
- `image` -- source image from an upstream node (Upload Image, Generate Image, etc.)

**Outputs:**
- `out` -- transformed image URL
## Supported Providers

| Provider | Label | Description | Key Capability |
|----------|-------|-------------|----------------|
| nano-banana | Nano Banana | Fast iteration, quick transforms | General I2I |
| nano-banana-pro | Nano Banana Pro | Higher detail, production images | General I2I, resolution options |
| grok-i2i | Grok | Creative and stylized imagery | Stylized transforms |
| flux-i2i | Flux-2 | Style-faithful transformations | Resolution options (1K/2K) |
| flux-pro-i2i | Flux-2 Pro | Premium quality image transforms | Resolution options (1K/2K) |
| gpt-image-i2i | GPT Image | Text rendering, complex compositions | Quality options (medium/high) |
| ideogram-edit | Ideogram Edit | AI-guided image editing | Mask-based inpainting |
| ideogram-remix | Ideogram Remix | Restyle with character consistency | Character-consistent restyling |
| ideogram-reframe | Ideogram Reframe | Change aspect ratio intelligently | Aspect ratio adjustment |
| qwen-i2i | Qwen | Versatile image transformation | General I2I |
| qwen-edit | Qwen Edit | Targeted image editing | Targeted edits |
| seedream-edit | Seedream Edit | Photorealistic image editing | Quality options (basic/high) |
| seedream-5-lite-i2i | Seedream 5 Lite | Latest Seedream image-to-image | Quality options (basic/high) |
| flux-kontext | Flux Kontext | Context-aware editing via Kontext | Context-aware transforms |
| flux-kontext-max | Flux Kontext Max | Highest quality Kontext editing | Premium context-aware transforms |
| kontext-multi | Kontext Multi (Open) | Multi-image Flux Kontext Pro via Replicate — no safety filter | Up to 2 reference images. 4 credits |
| flux-2-pro | Flux 2 Pro (Safety Tolerance) | BFL Flux 2 Pro flagship via Replicate — `safety_tolerance` pinned to 5 | Up to 4 reference images. Resolution 0.5 / 1 / 2 / 4 MP (default 2 MP); per-MP pricing — ~5 credits at 2 MP with the primary image. |
| flux-2-max | Flux 2 Max (Safety Tolerance) | BFL Flux 2 Max via Replicate — `safety_tolerance=5`, up to 8 reference images | Resolution 0.5 / 1 / 2 / 4 MP (default 2 MP). **Per-megapixel pricing** ($0.07/output-MP + $0.03/MP per input image): ~13 credits at 2 MP with the primary image, scaling with resolution and extra references. |

## Best Practices

- Start with a low strength value (0.3-0.5) to preserve more of the original image structure, then increase if you want more dramatic changes.
- Use Ideogram Edit with the mask painter for precise inpainting -- paint over the region you want changed and describe the replacement in the prompt.
- Ideogram Reframe is purpose-built for aspect ratio changes (e.g., converting a 1:1 image to 16:9) while intelligently filling new regions.
- For character-consistent restyling, use Ideogram Remix which preserves identity while changing the artistic style.
- Use Flux Kontext or Flux Kontext Max when you need context-aware editing that understands the semantic content of the image.

## Common Use Cases

- Restyling photographs into different artistic styles (oil painting, anime, watercolor).
- Inpainting specific regions of an image to replace or modify objects.
- Converting image aspect ratios for different platforms (Instagram square to YouTube widescreen).
- Applying consistent style transforms across a batch of images via Loop node.
- Creating variations of a generated image with controlled deviation via strength parameter.

## Tips

- Not all providers support every configuration field. The config panel dynamically shows/hides fields based on the selected provider. For example, mask is only available for ideogram-edit, and strength is only shown for providers that support it.
- Ideogram providers use rendering speed (turbo/balanced/quality) instead of resolution to control output quality and cost -- turbo is cheapest, quality is most expensive.
- When chaining Image to Image after Generate Image, the output of Generate Image connects to the `image` input handle. The `out` output handle feeds downstream nodes.
