# Image to Image
> Transform an existing image using AI with a text prompt, preserving structure while applying new styles, subjects, or modifications.

> **Note:** This page documents the `image-to-image` API endpoint / legacy node. In the editor, image-to-image is now part of the **Modify Image** node (see [modify-image.md](./modify-image.md)).

## Overview

Image to Image takes a source image and a text prompt to generate a transformed version. Unlike Edit Image (which focuses on utility operations like upscaling), Image to Image performs creative transformations: restyling, subject replacement, inpainting, reframing, and remix operations. It supports 23 provider models with varying capabilities including strength control, mask-based inpainting, guidance scale, and resolution options. The default provider is GPT Image 2.6 Flare (`gpt-image-2-6-flare-i2i`).

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | select | `gpt-image-2-6-flare-i2i` | AI model to use for transformation (26 options) |
| Prompt | text | `""` | Description of the desired transformation |
| Style | select | `""` | 16 presets + "Custom..." free text (same as Generate Image) |
| Negative Prompt | text | `""` | Elements to exclude from the result |
| Strength | slider (0-1) | varies | How much to deviate from the source image. Higher values mean more change. Only available for providers that support it. |
| Guidance Scale | number | varies | Prompt adherence strength. Only available for providers that support it. |
| Aspect Ratio | select | varies | Provider-specific ratio sets (same sets as Generate Image). **Auto** keeps your photo's shape; on models without a native auto, and on GPT Image 2.6 (whose own auto renders a portrait square), it picks the closest supported shape. An API request that names no ratio runs at Auto on the GPT Image 2, 2.5 and 2.6 models (the default included) and on MiniMax H3 Image, Seedream 5.5 and FLUX 3 Klein, at the same price; other models keep their own default. |
| Background | select | Auto | Available for GPT Image 2.5 and 2.6 and Seedream 5.5: auto, opaque or transparent. On GPT Image a transparent background renders at 1K (Seedream 5.5 renders one at every size). On GPT Image 2.5 the setting only applies at 1K. Transparent is kept only in PNG and WebP (with GIF or JPEG it becomes auto; an SVG takes no background setting). |
| Format | select | PNG | GPT Image 2.6 Flare and Sunburst: PNG, JPEG, WebP, GIF (animated, square, 512×512 a frame: the ratio and resolution do not apply) or SVG (vector). PNG, JPEG and WebP cost the same; a GIF is priced by quality and band of frames, an SVG as the PNG plus its level. Prices and rules: [Generate Image › Formats](./generate-image.md#formats-png-jpeg-webp-gif-and-svg). A mask cannot be used with a GIF or an SVG. MiniMax H3 Image: PNG or JPEG, the same price. Seedream 5.5: PNG or JPEG, the same price. FLUX 3 Klein: PNG or JPEG, the same price. |
| GIF frames / GIF speed | number | 9 / 200 | With Format GIF: 2 to 16 frames (2–8, 9–12 and 13–16 price differently), each shown 20 to 2000 ms. |
| SVG detail | select | SVG Standard | With Format SVG: SVG Standard, SVG Detailed or SVG Max. |
| Resolution | select | varies | Available for the GPT Image 2, 2.5 and 2.6 models: 1K, 2K, 4K; flux-i2i, flux-pro-i2i: 1K, 2K; seedream-5-flash-i2i: 1K, 2K (same price at either); minimax-h3-image-i2i: 1K, 2K (its default) or 4K, the same price at 1K and 2K; seedream-5-5-i2i: 1K, 1.5K, 2K (2K by default; 1K and 1.5K cost the same); flux-3-klein-i2i: 1K, 2K or 4K, 1K by default, priced by size. GPT Image 2.5 renders 27:16, 16:27, 9:8 and 8:9 at 1K only: a 2K or 4K request at those ratios runs, and is charged, at 1K and says so. GPT Image 2 renders every ratio it offers, `auto` and 1:1 included, at 1K, 2K and 4K, and is charged at the size asked. |
| Quality | select | varies | Available for GPT Image 2.6 Flare and Sunburst (auto, low, medium, high, extra high, max; medium by default; at auto the run costs what it really used, at most the max price), gpt-image-i2i (medium/high), seedream-edit (basic/high), seedream-5-lite-i2i (basic/high), seedream-5-pro-i2i (basic 1K / high 2K) |
| Rendering Speed | select | -- | Available for ideogram variants: turbo, balanced, quality |
| Seed | number | -- | Reproducibility seed (select providers) |
| Mask | image/canvas | -- | Inpainting mask for the mask models (ideogram-edit, flux-fill, gpt-image-2-6-flare-i2i, gpt-image-2-6-sunburst-i2i). White = the area to change, black = keep — the same on every model. Painted via a mask editor modal, or wired in from a Paint Mask or Generate Mask node. See [Masks](#masks). |
| Reference Image | image | -- | Additional reference for style guidance |

## Inputs & Outputs

**Inputs:**
- `image` -- source image from an upstream node (Upload Image, Generate Image, etc.)
- `mask` -- *optional* inpainting mask (white = change), shown on the mask models only

**Outputs:**
- `out` -- transformed image URL

## Masks

A mask limits the edit to the area painted white; black is kept. Four models take one: Ideogram Edit, FLUX Fill, and GPT Image 2.6 Flare and Sunburst (`gpt-image-2-6-flare-i2i`, `gpt-image-2-6-sunburst-i2i`). On any other model the mask is ignored (the editor hides it and clears a painted one).

- **GPT Image 2.6 keeps the rest of the picture exactly as it was.** The model redraws the whole picture, so after the run the source image is pasted back everywhere outside the mask, with a soft edge a few pixels wide just inside the painted area, so no seam shows. The result is the source image's size. In a PNG the area outside the mask is the source's own pixels; a JPEG or WebP is saved once more in its format. The job's output says so (`maskComposited: true`).
- **The size and shape follow the photo.** A masked GPT Image 2.6 edit always keeps the photo's shape (a ratio set on the node is ignored, and Auto picks the supported ratio nearest the photo), and renders at the size (1K, 2K or 4K) whose long side is nearest the photo's, by the model's own size table: a 768×1024 photo runs at 1K, a 3000×4000 one at 4K, whatever size is set. It is priced at that size, so you never pay for 4K and get a 1K picture. What changed is reported in the response's `adjustments`. When the photo's size cannot be read, the size set is kept.
- **A mask costs nothing extra.** A masked GPT Image 2.6 edit is priced exactly as the same edit without one at that size: by quality, size and input images, and the mask is not counted as an input image. The editor's price follows the photo when the node it comes from records the photo's size (a generated or uploaded image).
- **Not with a GIF or an SVG.** A mask with Format GIF or SVG is refused before anything is charged (`400`). PNG, JPEG and WebP take one.
- On GPT Image 2.6, grey in the mask is a partial change, so a soft brush edge stays soft.

## Supported Providers

| Provider | Label | Description | Key Capability |
|----------|-------|-------------|----------------|
| nano-banana | Nano Banana | Fast iteration, quick transforms | General I2I |
| nano-banana-2 | Nano Banana 2 | Updated Nano Banana; 1K/2K/4K resolution. Superseded by Nano Banana 2.1 (`nano-banana-2-1`); still available. | General I2I, resolution options |
| nano-banana-2-1 | Nano Banana 2.1 | Consistent edits with strong character consistency and text rendering; 1K / 2K / 4K at **11<!-- credits: nano-banana-2-1 --> / 22<!-- credits: nano-banana-2-1:2K --> / 33 credits**<!-- credits: nano-banana-2-1:4K --> | Up to 10 input images, resolution options |
| nano-banana-2-lite | Nano Banana 2 Lite | Fast, low-cost 1K edits (Gemini 3.1 Flash-Lite); flat 11 credits<!-- credits: nano-banana-2-lite --> | Up to 10 input images |
| nano-banana-pro | Nano Banana Pro | Higher detail, production images | General I2I, resolution options |
| grok-i2i | Grok | Creative and stylized imagery | Stylized transforms |
| flux-i2i | Flux-2 | Style-faithful transformations | Resolution options (1K/2K) |
| flux-pro-i2i | Flux-2 Pro | Premium quality image transforms | Resolution options (1K/2K) |
| gpt-image-i2i | GPT Image | Text rendering, complex compositions | Quality options (medium/high) |
| gpt-image-2-i2i | GPT Image 2 | Higher resolution GPT Image; 1K/2K/4K | Resolution options |
| gpt-image-2-5-flare-i2i | GPT Image 2.5 Flare | Fast GPT Image 2.5 edits, up to 16 source images; 1K/2K/4K at **17<!-- credits: gpt-image-2-5-flare-i2i --> / 28<!-- credits: gpt-image-2-5-flare-i2i:2K --> / 44 credits**<!-- credits: gpt-image-2-5-flare-i2i:4K --> | Resolution options |
| gpt-image-2-5-sunburst-i2i | GPT Image 2.5 Sunburst | Precision GPT Image 2.5 edits, up to 16 source images — tightest control for demanding retouches, slower; same **17<!-- credits: gpt-image-2-5-sunburst-i2i --> / 28<!-- credits: gpt-image-2-5-sunburst-i2i:2K --> / 44 credits**<!-- credits: gpt-image-2-5-sunburst-i2i:4K --> | Resolution options |
| gpt-image-2-6-flare-i2i | GPT Image 2.6 Flare | The default edit model. Fast GPT Image 2.6 edits, up to 16 input images, priced per image: at medium 1K, **29 credits**<!-- credits: gpt-image-2-6-flare-i2i:medium:1K:1ref --> with one image, **47 credits**<!-- credits: gpt-image-2-6-flare-i2i:medium:1K:4ref --> with four. As a 9–12 frame GIF at medium with one image, **38 credits**<!-- credits: gpt-image-2-6-flare-i2i:medium:gif-9-12:1ref -->; as an SVG Standard at medium 1K, **35 credits**<!-- credits: gpt-image-2-6-flare-i2i:medium:1K:svg-standard:1ref --> | Quality, resolution and format options; mask-based inpainting, the rest kept as it was |
| gpt-image-2-6-sunburst-i2i | GPT Image 2.6 Sunburst | Precision GPT Image 2.6 edits, up to 16 input images, for finished, detail-critical work. Same price as Flare | Quality and resolution options; mask-based inpainting, the rest kept as it was |
| ideogram-edit | Ideogram Edit | AI-guided image editing | Mask-based inpainting |
| ideogram-remix | Ideogram Remix | Restyle with character consistency | Character-consistent restyling |
| qwen-i2i | Qwen | Versatile image transformation | General I2I |
| qwen-edit | Qwen Edit | Targeted image editing | Targeted edits |
| seedream-edit | Seedream Edit | Photorealistic image editing | Quality options (basic/high) |
| seedream-5-lite-i2i | Seedream 5 Lite | Latest Seedream image-to-image | Quality options (basic/high) |
| seedream-5-pro-i2i | Seedream 5 Pro | Flagship Seedream image-to-image, multi-reference instruction edits. **21 credits**<!-- credits: seedream-5-pro-i2i --> at basic (1K) / **66 credits**<!-- credits: seedream-5-pro-i2i:high --> at high (2K). | Quality options (basic/high) |
| seedream-5-flash-i2i | Seedream 5 Flash | Fast, low-cost Seedream edits; flat **11 credits**<!-- credits: seedream-5-flash-i2i --> at 1K or 2K | Up to 10 input images, resolution options (1K/2K) |
| minimax-h3-image-i2i | MiniMax H3 Image | Change or combine up to 16 images in one edit, with readable text inside the picture, up to about 16 MP at 4K. Priced by size, the same at 1K and 2K (2K by default), and by each image the edit is given, the source included: at 2K, **7 credits**<!-- credits: minimax-h3-image-i2i:2K:1ref --> with one image, **11 credits**<!-- credits: minimax-h3-image-i2i:2K:4ref --> with four, **28 credits**<!-- credits: minimax-h3-image-i2i:2K:16ref --> with sixteen; at 4K, **17 credits**<!-- credits: minimax-h3-image-i2i:4K:1ref --> with one and **38 credits**<!-- credits: minimax-h3-image-i2i:4K:16ref --> with sixteen. Auto keeps the first image's shape | Up to 16 input images, resolution options (1K/2K/4K), seed, PNG or JPEG |
| seedream-5-5-i2i | Seedream 5.5 | Edits round after round that change what you ask and leave the rest of the picture as it was; natural light, materials and skin, dense small text, a transparent background in one step. Priced by size and by each input image (the source counts as one): **15 credits**<!-- credits: seedream-5-5-i2i:1K:1ref --> at 1K or 1.5K and **22 credits**<!-- credits: seedream-5-5-i2i:2K:1ref --> at 2K with the source alone, up to **50**<!-- credits: seedream-5-5-i2i:1K:10ref --> / **58 credits**<!-- credits: seedream-5-5-i2i:2K:10ref --> with ten images. Prompts 5 to 5,000 characters. | Up to 10 input images, resolution options (1K/1.5K/2K), background, PNG or JPEG |
| flux-3-klein-i2i | FLUX 3 Klein | Fast, low-cost edits from the light model of FLUX 3, with 1 to 10 images, the source included. Priced by size alone, and the images cost nothing extra: **5 credits**<!-- credits: flux-3-klein-i2i:1K --> at 1K, the default, **8 credits**<!-- credits: flux-3-klein-i2i:2K --> at 2K, **19 credits**<!-- credits: flux-3-klein-i2i:4K --> at 4K. Auto takes the first image's shape. PNG or JPEG. Takes a seed, prompts up to 5,000 characters. More than 10 images is refused before anything is charged. | Up to 10 input images, resolution options (1K/2K/4K) |
| flux-kontext | Flux Kontext | Context-aware editing via Kontext | Context-aware transforms |
| flux-kontext-max | Flux Kontext Max | Highest quality Kontext editing | Premium context-aware transforms |
| kontext-multi | Kontext Multi (Open) | Multi-image Flux Kontext Pro via Replicate | Up to 2 reference images. 33 credits<!-- credits: kontext-multi --> |
| flux-2-pro | Flux 2 Pro (Safety Tolerance) | BFL Flux 2 Pro flagship via Replicate | Up to 4 reference images. Resolution 0.5 / 1 / 2 / 4 MP (default 2 MP); per-MP pricing — ~42 credits at 2 MP with the primary image. |
| flux-2-max | Flux 2 Max (Safety Tolerance) | BFL Flux 2 Max via Replicate, up to 8 reference images | Resolution 0.5 / 1 / 2 / 4 MP (default 2 MP). **Per-megapixel pricing**: ~110 credits at 2 MP with the primary image (1 ref), scaling with resolution and extra references. |

## Best Practices

- Start with a low strength value (0.3-0.5) to preserve more of the original image structure, then increase if you want more dramatic changes.
- Use GPT Image 2.6 Flare or Sunburst (or Ideogram Edit, FLUX Fill) with the mask painter for precise inpainting -- paint over the region you want changed and describe the replacement in the prompt. On GPT Image 2.6 everything outside the mask stays exactly as it was.
- Ideogram Reframe (`ideogram-reframe`) was retired on 2026-09-15 — the provider stopped serving the model, so it is no longer selectable. For an aspect-ratio change with AI fill, use `nano-banana-edit` with the target `aspectRatio` and a prompt such as "extend the scene naturally into the new space, matching light and perspective".
- For character-consistent restyling, use Ideogram Remix which preserves identity while changing the artistic style.
- Use Flux Kontext or Flux Kontext Max when you need context-aware editing that understands the semantic content of the image.

## Common Use Cases

- Restyling photographs into different artistic styles (oil painting, anime, watercolor).
- Inpainting specific regions of an image to replace or modify objects.
- Converting image aspect ratios for different platforms (Instagram square to YouTube widescreen).
- Applying consistent style transforms across a batch of images via Loop node.
- Creating variations of a generated image with controlled deviation via strength parameter.

## Tips

- Not all providers support every configuration field. The config panel dynamically shows/hides fields based on the selected provider. For example, mask is only available for the mask models (see [Masks](#masks)), and strength is only shown for providers that support it.
- Ideogram providers use rendering speed (turbo/balanced/quality) instead of resolution to control output quality and cost -- turbo is cheapest, quality is most expensive.
- When chaining Image to Image after Generate Image, the output of Generate Image connects to the `image` input handle. The `out` output handle feeds downstream nodes.
- **An `{image:N}` token with no reference image at its position becomes its label** — `{image:1:person}` reads as `person`, a bare `{image:1}` is left out, and an image label is any text up to the closing brace (`{image:1:man's jacket}` reads as `man's jacket`).
