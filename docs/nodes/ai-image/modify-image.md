# Modify Image

> Transform an existing image with a text prompt across 20+ image-to-image and editing providers.

## Overview

Modify Image takes a source image and re-renders it according to a transformation prompt. It is the prompt-driven editing node: pick a provider, describe the change, and the model returns a new image. It exposes the full image-to-image catalog (Flux-2, Flux Kontext, GPT Image, Grok, Ideogram, Nano Banana, Qwen, Seedream, plus Replicate-backed Kontext Multi and Flux 2 Pro/Max) and adds **Nano Banana Edit** for context-aware instruction editing. The default provider is Nano Banana.

For non-prompt utility operations (pure upscaling, background removal) use [Upscale Image](./upscale-image.md) or [Remove Background](./remove-background.md) instead.

## How it works

- Connect a source image to the `image` input (from Upload Image, Generate Image, or any image-producing node).
- Pick a provider and write a transformation prompt describing the change.
- Optionally pick a style preset (or enter custom style text), add a negative prompt, set aspect ratio, seed, and a reference image — exactly which controls apply depends on the selected provider.
- The aspect ratio control offers **Auto (match the photo)** on every model. Auto keeps your photo's shape; on models without a native auto, and on GPT Image 2.6 (the default, whose own auto renders a portrait square), it picks the closest supported shape. A node with no ratio set is Auto: the panel shows Auto, and the run asks for Auto (it used to send no ratio, and the model's own default — 16:9 on most models — reframed the photo). On GPT Image 2 (`gpt-image-2-i2i`) Auto is the model's own and keeps the shape at 1K, 2K or 4K, priced by the size. The API and the MCP `modify_image` and `image_to_image` tools run a GPT Image 2, 2.5 or 2.6 edit that names no ratio at Auto too. Opening the panel keeps it; any other ratio a newly picked model does not list still switches to that model's first ratio.
- On GPT Image 2.6 Flare and Sunburst (the default), **Format** writes the result as PNG (the default), JPEG, WebP, an animated GIF (2 to 16 square frames of 512×512, with their speed; the aspect ratio and resolution do not apply) or an SVG (SVG Standard, Detailed or Max). PNG, JPEG and WebP cost the same; prices for a GIF and an SVG are in [Generate Image › Formats](./generate-image.md#formats-png-jpeg-webp-gif-and-svg). A transparent background is kept only in PNG and WebP, and a mask cannot be used with a GIF or an SVG.
- The node returns the transformed image on the `image` handle.
- **An `{image:N}` token with no reference image at its position becomes its label** — `{image:1:person}` reads as `person`, a bare `{image:1}` is left out, and an image label is any text up to the closing brace (`{image:1:man's jacket}` reads as `man's jacket`). This holds on every model, Nano Banana Edit included, in the editor and in a workflow run alike.

## Inputs & Outputs

**Inputs:**
- `image` — source image from an upstream node (required).
- `mask` — *optional* inpainting mask (white = edit, black = preserve). Shown, and sent, on the models that take a mask: GPT Image 2.6 Flare and Sunburst (the default included), Ideogram Edit and FLUX Fill. Wire one from a [Generate Mask](./generate-mask.md) or [Paint Mask](./paint-mask.md) node, or paint in place with the Mask Painter in the settings panel.

**Outputs:**
- `image` — the modified image URL.

### Masks on GPT Image 2.6

- **The rest of the picture is kept exactly as it was.** GPT Image 2.6 redraws the whole picture, so after the run the source image is pasted back everywhere outside the mask, with a soft edge a few pixels wide just inside the painted area. The result is the source image's size. In a PNG the area outside the mask is the source's own pixels; a JPEG or WebP is saved once more in its format.
- **The size and shape follow the photo.** The edit keeps the photo's shape (the node's Aspect Ratio is ignored) and renders at the size (1K, 2K or 4K) whose long side is nearest the photo's, whatever size is set: a 768×1024 photo runs at 1K, a 3000×4000 one at 4K. It is priced at that size. When the photo's size cannot be read, the size set is kept.
- **A mask costs nothing extra:** the edit is priced as the same edit without one at that size, and the mask is not counted as an input image.
- **Grey is a partial change**, so a soft brush edge stays soft.
- **PNG, JPEG or WebP only:** a mask with Format GIF or SVG is refused before anything is charged.

## Supported Providers

Modify Image exposes the full image-to-image provider catalog plus Nano Banana Edit:

| Provider | Notes |
|----------|-------|
| Flux-2 / Flux-2 Pro | Style-faithful transformations; Pro is premium quality |
| Flux Kontext / Flux Kontext Max | Context-aware editing via Kontext |
| GPT Image / GPT Image 2 | Strong text rendering and complex compositions; GPT Image 2 supports up to 4K |
| Grok | Creative, stylized imagery |
| Ideogram Edit / Remix | AI-guided editing and restyling with character consistency |
| Nano Banana / Nano Banana Pro | Fast iteration; Pro for higher detail |
| Qwen / Qwen Edit | Versatile transformation and targeted editing |
| Seedream 5 Pro / Seedream 5 Lite / Seedream 5 Flash / Seedream Edit | Seedream image-to-image — Pro for flagship instruction edits, Flash for fast low-cost edits (1K or 2K), Lite and Edit for lighter transforms |
| MiniMax H3 Image | Change or combine up to 16 images in one edit, with readable text inside the picture, up to about 16 MP at 4K; priced by size and by each image |
| Kontext Multi (Open) | Multi-image Flux Kontext via Replicate (up to 2 reference images) |
| Flux 2 Pro / Flux 2 Max (Safety Tolerance) | BFL Flux 2 via Replicate; Max supports up to 8 refs |
| Nano Banana Edit | Context-aware editing from a text instruction (style presets, negative prompt, aspect ratio, seed, asset references) |

## Pricing

Credits depend on the selected provider, and several providers cost more at higher quality/resolution settings. Typical costs range from **7 credits**<!-- credits: minimax-h3-image-i2i:2K:1ref --> (MiniMax H3 Image, one image at 1K or 2K) to **~682 credits** (Flux 2 Max at 4 MP with 8 references). Representative prices:

| Provider | Credits |
|----------|---------|
| Nano Banana | 11<!-- credits: nano-banana --> |
| Flux-2 Pro | 15<!-- credits: flux-pro-i2i --> (1K) → 22<!-- credits: flux-pro-i2i:2K --> (2K) |
| Nano Banana Edit | 11<!-- credits: nano-banana-edit --> |
| Flux-2 | 66<!-- credits: flux-i2i --> (1K) → 66<!-- credits: flux-i2i:2K --> (2K) |
| GPT Image | 11<!-- credits: gpt-image-i2i --> (medium) → 66<!-- credits: gpt-image-i2i:high --> (high) |
| Seedream 5 Pro | 21<!-- credits: seedream-5-pro-i2i --> (basic / 1K) → 66<!-- credits: seedream-5-pro-i2i:high --> (high / 2K) |
| Seedream 5 Flash | 11<!-- credits: seedream-5-flash-i2i --> (1K or 2K) |
| MiniMax H3 Image | 7<!-- credits: minimax-h3-image-i2i:2K:1ref --> (1K or 2K, one image) → 17<!-- credits: minimax-h3-image-i2i:4K:1ref --> (4K, one image); 28<!-- credits: minimax-h3-image-i2i:2K:16ref --> at 2K with sixteen images |
| Ideogram Edit / Remix | 50<!-- credits: ideogram-edit --> (Balanced) → 33<!-- credits: ideogram-edit:TURBO --> (Turbo) / 66<!-- credits: ideogram-edit:QUALITY --> (Quality) |
| Nano Banana Pro | 50<!-- credits: nano-banana-pro --> (1K/2K) → 66<!-- credits: nano-banana-pro:4K --> (4K) |
| Flux 2 Max | 77 credits<!-- credits: flux-2-max:2MP:0ref --> at default (2 MP, 0 refs); ranges 20<!-- credits: flux-2-max:0.5MP:0ref -->–682<!-- credits: flux-2-max:4MP:8ref --> depending on resolution and reference count |

The exact credit cost for the selected provider and settings is shown on the node's Run button before you generate.

## Pre & post text

This node supports `promptPrefix` / `promptSuffix` — optional text wrapped around the prompt at run time (settings panel → **Pre & post text**; hidden from app users; captured by presets). See [Prompt pre & post text](../../prompt-pre-post-text.md).
