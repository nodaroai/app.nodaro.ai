# Upload Image

> Upload or provide a URL to an image file.

## Overview

The Upload Image node provides a source image to the workflow. Enter a direct URL to an image or upload a file. The image is then available to any downstream node that accepts image input.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| URL | Text input | — | Direct URL to an image file; it is copied into your storage and opened in **Adjust Image**, like a chosen file (a link that cannot be copied is used as it is) |

Accepts: PNG, JPEG, WebP, GIF, AVIF and HEIC files. A pasted link in one of these formats, up to 20 MB, is copied and opened in **Adjust Image**; any other image link is used as it is.

## Adjust Image

Choosing a file, or pasting an image URL, opens an **Adjust Image** step before the upload is committed: crop with an aspect-ratio preset (or freeform), and optionally convert to PNG, JPEG or WebP (under **Advanced**). Cropping happens in the browser, so the uploaded file is already the cropped region.

A pasted URL is first copied into your storage (JPEG, PNG, WebP, AVIF, GIF or HEIC, up to 20 MB) and read back into the browser, so the picture can be cropped like a file of your own; the temporary copy is removed as soon as it is read, before **Adjust Image** opens. The node then uses your adjusted upload, and cancelling adds nothing. If the link cannot be copied (a format other than those, a host that refuses the copy, a larger picture, full storage), the node uses the link as it is, without **Adjust Image**, and says so.

## Inputs & Outputs

**Inputs:** None (this is a source node)

**Outputs:**
- Image URL — accessible to downstream nodes
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
