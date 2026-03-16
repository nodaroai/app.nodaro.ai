# Upload Image

> Upload or provide a URL to an image file.

## Overview

The Upload Image node provides a source image to the workflow. Enter a direct URL to an image or upload a file. The image is then available to any downstream node that accepts image input.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| URL | Text input | — | Direct URL to an image file |

Accepts: PNG, JPEG, WebP formats.

## Inputs & Outputs

**Inputs:** None (this is a source node)

**Outputs:**
- Image URL — accessible to downstream nodes

## Credit Cost

0 credits — always free.

## Best Practices

- Use high-resolution source images for best downstream results
- Ensure the URL is publicly accessible or upload the file directly
- For AI generation workflows, clear and well-composed images produce better results

## Common Use Cases

- Source image for Image to Video generation
- Input for Image to Image transformation
- Reference image for character or style consistency
- Source for Edit Image (upscale, background removal)

## Tips

- Connect to multiple downstream nodes to use the same image across different operations
- For images from social platforms, use the Video URL node instead (it handles platform-specific downloads)
