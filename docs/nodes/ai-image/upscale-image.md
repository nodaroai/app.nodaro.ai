# Upscale Image

> Increase the resolution of an image with Recraft or Topaz AI upscaling.

## Overview

Upscale Image enhances an existing image to a higher resolution. It offers two providers: **Recraft Upscale** for fast, low-cost enhancement, and **Topaz Upscale** for premium AI upscaling with an explicit 1x / 2x / 4x factor. Unlike [Modify Image](./modify-image.md), this node does not take a prompt — it is a pure enhancement utility. The default provider is Recraft Upscale.

## How it works

- Connect a source image to the input handle (from Upload Image, Generate Image, or any image-producing node).
- Pick a provider.
- For Topaz, choose an **Upscale Factor** (1x enhance-only, 2x, or 4x). Recraft has no extra options.
- The node returns the upscaled image.

## Supported Providers

| Provider | Description |
|----------|-------------|
| Recraft Upscale | Fast, high-quality upscaling and enhancement. No additional configuration. |
| Topaz Upscale | Premium AI upscaling with a configurable factor (1x / 2x / 4x). Higher factors cost more credits. |

## Pricing

| Provider / Setting | Credits |
|--------------------|---------|
| Recraft Upscale | 2 |
| Topaz Upscale (1x / 2x) | 25 |
| Topaz Upscale (4x) | 50 |

The exact credit cost for the selected provider and factor is shown on the node's Run button before you generate.

## Tips

- HEIC/HEIF and AVIF photos and other non-JPEG formats are converted before the run, so they work as inputs even where the provider itself only takes JPEG, PNG or WebP. The conversion is lossless wherever the provider accepts a lossless format, so transparency and fine detail survive it.
- This matters most for images supplied by URL through the API, which can arrive in any format — the in-app uploader already restricts what it accepts.
