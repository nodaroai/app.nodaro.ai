# Face Swap

> Replace the face in a video with a face from a reference image.

## Overview

The Face Swap node takes a video and a reference face image and replaces the face in the video using the Roop model via Replicate. Useful for character replacement, privacy preservation, or creative remixing.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | Select | roop | AI model for face swapping (currently only Roop) |

## Inputs & Outputs

**Inputs:**
- Face Image (required) — clear photo of the target face to apply
- Video (required) — source video containing the face to replace

**Outputs:**
- Face-swapped video

## Credit Cost

| Provider | Credits |
|----------|---------|
| roop | 13 credits |

## Best Practices

- Use a clear, front-facing face photo for best swap accuracy
- Source video should have a clearly visible face
- Shorter videos produce faster results and lower credit usage
- Well-lit, high-contrast face images yield cleaner swaps

## Common Use Cases

- Replace a placeholder actor with a final character in a storyboard video
- Anonymise faces in recorded footage
- Apply a consistent character face across multiple generated clips
