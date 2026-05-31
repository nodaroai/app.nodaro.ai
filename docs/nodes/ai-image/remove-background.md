# Remove Background

> Automatically remove the background from an image, leaving a transparent PNG.

## Overview

Remove Background strips the background from a source image and returns a transparent PNG, ready for compositing. It uses Recraft's background-removal model and requires no configuration — connect an image and run.

## How it works

- Connect a source image to the input handle (from Upload Image, Generate Image, or any image-producing node).
- Run the node. The background is removed automatically.
- The node returns a transparent PNG with the subject isolated.

## Inputs & Outputs

**Inputs:** Source image (required).

**Outputs:** The image with its background removed (transparent PNG).

## Best Practices

- Results are best when the subject has clear edges against the background. Complex scenes with hair or transparent objects may need manual cleanup downstream.
- Chain with [Upscale Image](./upscale-image.md) or a composition node to place the cut-out subject onto a new background.

## Pricing

Costs **1 credit** per image (Recraft background removal).
