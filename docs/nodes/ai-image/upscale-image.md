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
| Topaz Upscale | Premium AI upscaling with a configurable factor (1x / 2x / 4x). Higher factors, and very large outputs, cost more credits. |

## Pricing

| Provider / Setting | Credits |
|--------------------|---------|
| Recraft Upscale | 3<!-- credits: recraft-upscale --> |
| Topaz Upscale (1x / 2x) | 28<!-- credits: topaz-image-upscale --> |
| Topaz Upscale (4x) | 55<!-- credits: topaz-image-upscale:4K --> |

**Very large Topaz outputs cost more.** Topaz is billed by the size of the image it produces. Up to 24 megapixels out (for example a 2× of anything up to about 2400 × 2400, or a 4× of up to about 1200 × 1200) costs the price above. A larger output costs the 1× / 2× price once per size step, whenever that is more than the price above:

| Output size | Steps |
|---|---:|
| up to 24 MP | 1 |
| up to 48 MP | 2 |
| up to 60 MP | 3 |
| up to 96 MP | 4 |
| up to 132 MP | 5 |
| up to 168 MP | 6 |
| up to 336 MP | 11 |
| up to 512 MP | 17 |

For example, a 4× upscale of a 2048 × 2048 image produces about 67 megapixels (4 steps) and costs **110**<!-- credits: topaz-image-upscale@4 --> credits instead of 55<!-- credits: topaz-image-upscale:4K -->. An upscale that would produce more than **512 megapixels** is refused before anything is charged. Choose a smaller factor or a smaller image. If the image's size cannot be read before the run, the price above is charged.

The node's Run button shows the price for the selected provider and factor; the size step is applied when the run starts and the image is measured.

Topaz returns a lossless **PNG** for outputs up to 24 megapixels, and a **JPG** above that (a PNG that large can run to 100 MB or more).

## Tips

- HEIC/HEIF and AVIF photos and other non-JPEG formats are converted before the run, so they work as inputs even where the provider itself only takes JPEG, PNG or WebP. The conversion is lossless wherever the provider accepts a lossless format, so transparency and fine detail survive it.
- This matters most for images supplied by URL through the API, which can arrive in any format — the in-app uploader already restricts what it accepts.
