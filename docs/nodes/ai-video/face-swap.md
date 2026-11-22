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
- Face Image (required) — clear photo of the target face to apply. Connect an uploaded or generated image, or a Face or Character node (its portrait is used). Any size or format works: a photo longer than 1280 pixels on its long side, a transparent one, a non-JPEG one or a phone photo saved sideways is sent upright, as a JPEG fitted to 1280 pixels (on white where it was transparent).
- Video (required) — source video containing the face to replace, up to **60 seconds** long

A run without both inputs stops before it starts and names the missing one; no credits are charged.

**Outputs:**
- Face-swapped video, with the source video's own sound (dialogue, music, ambience). A source without sound gives a silent result.

## Video length

Face Swap takes a video of up to **60 seconds**. Its length is read before anything is charged, on every path (the editor, a workflow or app run, the API, the SDK and MCP): a longer video, or one whose length cannot be read, is refused with `400 video_too_long` or `400 video_unreadable` and nothing is charged. A video up to 0.05 seconds past the limit (a re-encoded file often runs a few hundredths past its length) is accepted. Trim a longer video first.

## Credit Cost

| Provider | Credits |
|----------|---------|
| roop | from 149 credits<!-- credits: roop-face-swap --> |

A run is charged 149 credits<!-- credits: roop-face-swap -->, which is also the least it costs. Face Swap runs on GPU time, which grows with the video's length and detail: a run whose processing took longer than that price covers is charged for the processing time it used, when it ends. A failed run is refunded in full.

## Best Practices

- Use a clear, front-facing face photo for best swap accuracy
- Source video should have a clearly visible face
- Shorter videos produce faster results and lower credit usage
- Well-lit, high-contrast face images yield cleaner swaps

## Common Use Cases

- Replace a placeholder actor with a final character in a storyboard video
- Anonymise faces in recorded footage
- Apply a consistent character face across multiple generated clips
