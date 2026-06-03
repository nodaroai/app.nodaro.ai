# Upscale Image

> Increase the resolution of an image with Recraft or Topaz AI upscaling.

## Overview

Upscale Image enhances an existing image to a higher resolution. It offers two providers: **Recraft Upscale** for fast, low-cost enhancement, and **Topaz Upscale** for premium AI upscaling with explicit resolution control. Unlike [Modify Image](./modify-image.md), this node does not take a prompt — it is a pure enhancement utility. The default provider is Recraft Upscale.

## How it works

- Connect a source image to the input handle (from Upload Image, Generate Image, or any image-producing node).
- Pick a provider.
- For Topaz, choose an **Upscale Factor** (1x enhance-only, 2x, or 4x) and a **Target Resolution** (2K / 4K / 8K). Recraft has no extra options.
- The node returns the upscaled image.

## Supported Providers

| Provider | Description |
|----------|-------------|
| Recraft Upscale | Fast, high-quality upscaling and enhancement. No additional configuration. |
| Topaz Upscale | Premium AI upscaling with configurable factor (1x / 2x / 4x) and target resolution (2K / 4K / 8K). Higher resolution costs more credits. |

## Pricing

| Provider / Setting | Credits |
|--------------------|---------|
| Recraft Upscale | 1 |
| Topaz Upscale (2K, default) | 3 |
| Topaz Upscale (4K) | 5 |
| Topaz Upscale (8K) | 10 |

The exact credit cost for the selected provider and resolution is shown on the node's Run button before you generate.
