# Remove Audio

> Strip the audio track from a video, leaving a silent clip.

## Overview

The Remove Audio node removes the audio track from a video and outputs a silent clip. The video stream is **stream-copied** (`-c:v copy`), so there's no re-encode — the operation is lossless and near-instant.

It's the video half of "splitting" a clip — pair it with [Extract Audio](../processing-audio/extract-audio.md) (the audio half), or use it on its own to mute a video before injecting new sound.

There are no settings — connect a video and run.

## Inputs & Outputs

**Inputs:** Video (required)

**Outputs:**
- Video (silent)

## Configuration

This node has no configurable fields.

## Best Practices

- Use this when you want to replace a video's audio: Remove Audio → [Merge Video & Audio](../processing-audio/merge-video-audio.md) with your new track. (Merge can also drop the original audio directly, so pre-muting is optional.)
- Want the audio track instead of the silent video? Use [Extract Audio](../processing-audio/extract-audio.md).

## Common Use Cases

- Mute a video before adding sound effects or a different soundtrack
- Produce a clean, silent background clip for compositing
- Drop an unwanted audio track losslessly without re-encoding

## Tips

- Because the video is stream-copied, output quality and codec are identical to the input — no quality loss and very fast.
- If the video already has no audio, the node simply returns it unchanged (silent).
