# Modify Image

> Transform an existing image with a text prompt across 20+ image-to-image and editing providers.

## Overview

Modify Image takes a source image and re-renders it according to a transformation prompt. It is the prompt-driven editing node: pick a provider, describe the change, and the model returns a new image. It exposes the full image-to-image catalog (Flux-2, Flux Kontext, GPT Image, Grok, Ideogram, Nano Banana, Qwen, Seedream, plus Replicate-backed Kontext Multi and Flux 2 Pro/Max) and adds **Nano Banana Edit** for context-aware instruction editing. The default provider is Nano Banana.

For non-prompt utility operations (pure upscaling, background removal) use [Upscale Image](./upscale-image.md) or [Remove Background](./remove-background.md) instead.

## How it works

- Connect a source image to the `image` input (from Upload Image, Generate Image, or any image-producing node).
- Pick a provider and write a transformation prompt describing the change.
- Optionally pick a style preset (or enter custom style text), add a negative prompt, set aspect ratio, seed, and a reference image — exactly which controls apply depends on the selected provider.
- The node returns the transformed image on the `image` handle.
- **An `{image:N}` token with no reference image at its position becomes its label** — `{image:1:person}` reads as `person`, a bare `{image:1}` is left out, and an image label is any text up to the closing brace (`{image:1:man's jacket}` reads as `man's jacket`).

## Inputs & Outputs

**Inputs:**
- `image` — source image from an upstream node (required).
- `mask` — *optional* inpainting mask (white = edit, black = preserve). Forwarded to providers that support masks. Wire one from a [Generate Mask](./generate-mask.md) or [Paint Mask](./paint-mask.md) node, or paint in place: an interactive Mask Painter is available when the **Ideogram Edit** provider is selected.

**Outputs:**
- `image` — the modified image URL.

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
| Kontext Multi (Open) | Multi-image Flux Kontext via Replicate (up to 2 reference images) |
| Flux 2 Pro / Flux 2 Max (Safety Tolerance) | BFL Flux 2 via Replicate; Max supports up to 8 refs |
| Nano Banana Edit | Context-aware editing from a text instruction (style presets, negative prompt, aspect ratio, seed, asset references) |

## Pricing

Credits depend on the selected provider, and several providers cost more at higher quality/resolution settings. Typical costs range from **10 credits** (Nano Banana) to **~620 credits** (Flux 2 Max at 4 MP with 8 references). Representative base rates:

| Provider | Credits |
|----------|---------|
| Nano Banana | 10 |
| Flux-2 Pro | 13 (1K) → 20 (2K) |
| Nano Banana Edit | 10 |
| Flux-2 | 60 (1K) → 60 (2K) |
| GPT Image | 10 (medium) → 60 (high) |
| Seedream 5 Pro | 19 (basic / 1K) → 60 (high / 2K) |
| Seedream 5 Flash | 10 (1K or 2K) |
| Ideogram Edit / Remix | 45 (Balanced) → 30 (Turbo) / 60 (Quality) |
| Nano Banana Pro | 45 (1K/2K) → 60 (4K) |
| Flux 2 Max | ~70 credits at default (2 MP, 0 refs); ranges ~18–620 depending on resolution and reference count |

The exact credit cost for the selected provider and settings is shown on the node's Run button before you generate.

## Pre & post text

This node supports `promptPrefix` / `promptSuffix` — optional text wrapped around the prompt at run time (settings panel → **Pre & post text**; hidden from app users; captured by presets). See [Prompt pre & post text](../../prompt-pre-post-text.md).
