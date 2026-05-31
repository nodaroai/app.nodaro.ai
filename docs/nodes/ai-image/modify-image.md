# Modify Image

> Transform an existing image with a text prompt across 20+ image-to-image and editing providers.

## Overview

Modify Image takes a source image and re-renders it according to a transformation prompt. It is the prompt-driven editing node: pick a provider, describe the change, and the model returns a new image. It exposes the full image-to-image catalog (Flux-2, Flux Kontext, GPT Image, Grok, Ideogram, Nano Banana, Qwen, Seedream, plus Replicate-backed Kontext Multi and Flux 2 Pro/Max) and adds **Nano Banana Edit** for context-aware instruction editing. The default provider is Nano Banana.

For non-prompt utility operations (pure upscaling, background removal) use [Upscale Image](./upscale-image.md) or [Remove Background](./remove-background.md) instead.

## How it works

- Connect a source image to the `image` input (from Upload Image, Generate Image, or any image-producing node).
- Pick a provider and write a transformation prompt describing the change.
- Optionally pick a style preset (or enter custom style text), add a negative prompt, set aspect ratio, seed, and a reference image — exactly which controls apply depends on the selected provider.
- The node returns the transformed image on the `out` handle.

## Inputs & Outputs

**Inputs:**
- `image` — source image from an upstream node (required).
- `mask` — *optional* inpainting mask (white = edit, black = preserve). Forwarded to providers that support masks. An interactive Mask Painter is available when the **Ideogram Edit** provider is selected.

**Outputs:**
- `out` — the modified image URL.

## Supported Providers

Modify Image exposes the full image-to-image provider catalog plus Nano Banana Edit:

| Provider | Notes |
|----------|-------|
| Flux-2 / Flux-2 Pro | Style-faithful transformations; Pro is premium quality |
| Flux Kontext / Flux Kontext Max | Context-aware editing via Kontext |
| GPT Image / GPT Image 2 | Strong text rendering and complex compositions; GPT Image 2 supports up to 4K |
| Grok | Creative, stylized imagery |
| Ideogram Edit / Reframe / Remix | AI-guided editing, intelligent reframing, and restyling with character consistency |
| Nano Banana / Nano Banana Pro | Fast iteration; Pro for higher detail |
| Qwen / Qwen Edit | Versatile transformation and targeted editing |
| Seedream 5 Lite / Seedream Edit | Latest Seedream image-to-image and photorealistic editing |
| Kontext Multi (Open) | Multi-image Flux Kontext via Replicate (up to 4 refs) |
| Flux 2 Pro / Flux 2 Max (Safety Tolerance) | BFL Flux 2 via Replicate; Max supports up to 8 refs |
| Nano Banana Edit | Context-aware editing from a text instruction (style presets, negative prompt, aspect ratio, seed, asset references) |

## Pricing

Credits depend on the selected provider, and several providers cost more at higher quality/resolution settings. Typical costs range from **1 to ~18 credits**. Representative base rates:

| Provider | Credits |
|----------|---------|
| Nano Banana | 1 |
| Flux-2 Pro | 2 (1K) → 2 (2K) |
| Nano Banana Edit | 2 |
| Ideogram Reframe | 2 (Balanced) → 1 (Turbo) / 3 (Quality) |
| Flux-2 | 4 (1K) → 6 (2K) |
| GPT Image | 4 (medium) → 6 (high) |
| Ideogram Edit / Remix | 5 (Balanced) → 3 (Turbo) / 6 (Quality) |
| Nano Banana Pro | 5 (1K/2K) → 6 (4K) |
| Flux 2 Max | 5–18 (variable) |

The exact credit cost for the selected provider and settings is shown on the node's Run button before you generate.
