# Gif to Video

> Convert an animated GIF into an MP4 so it can be used as a motion reference.

## Overview

The Gif to Video node converts an animated GIF into a widely-compatible H.264 MP4. Its main purpose is to feed a GIF as a **motion reference** to video models that reject GIF in the video-reference slot (for example Seedance) — convert the GIF first, then wire the resulting MP4 into the video node like any other clip.

It renders locally with FFmpeg — no AI model, no provider, and **zero credits**.

The GIF can arrive two ways: connect an upstream image producer (an uploaded `.gif`) to the node's image input, or upload a GIF directly through the node's own dropzone.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Extend short GIFs to a target length | Toggle | on | Loop the GIF up to the target duration so it clears the reference-clip floor |
| Target Duration | Slider (2–8s) | 3s | Length to loop up to when extending |
| Motion smoothing | Select | Smooth | Smooth (interpolate to 24fps) or Preserve original timing |
| Transparent background | Select | White | Colour a transparent GIF is flattened onto (White / Black) |

### Looping behaviour

Most GIFs are shorter than the ~2 seconds a motion reference needs, so the node loops the GIF up to the target duration. Looping is **seam-aware**:

- **Seamless GIF** (last frame ≈ first frame) — repeated end-to-end.
- **Non-seamless GIF** — played forward then reversed (ping-pong), so a hard repeat's jump-cut isn't reproduced by the model as a motion event.

A GIF already below the ~2s floor is looped regardless of the toggle. A GIF longer than 8s is trimmed into the 3–8s window (longer references make the model pick motion inconsistently between runs).

### Motion smoothing

- **Smooth** — synthesizes in-between frames for genuinely smooth 24fps motion. Best for realistic footage.
- **Preserve original timing** — keeps the GIF's stepped, choppy character. Best for high-contrast graphic animation, where interpolation can smear.

## Inputs & Outputs

**Inputs:** GIF (image input, or the node's own upload) — required
**Outputs:** MP4 video

## Credit Cost

**Zero credits.** The conversion runs locally with FFmpeg — there is no provider call. Converted results are cached, so re-running the same GIF with the same settings is instant.

## Best Practices

- Convert a GIF here first, then wire the MP4 output into a video node's reference input — passing a GIF directly is rejected by models that accept only MP4/MOV.
- Leave interpolation on for realistic footage; turn it off for pixel-art or hard-edged graphic loops.
- Keep reference clips short (the node targets 3–8s): a long reference makes the model uncertain about which motion to prioritise.

## Common Use Cases

- Use a reaction GIF as the motion reference for a Seedance generation.
- Turn a looping animation into an MP4 for editing, overlays, or upload.
- Normalise a mixed-delay GIF into a constant-frame-rate clip.

## Tips

- A single-frame GIF (a still saved as `.gif`) produces a short static clip with a warning — there is no motion to transfer.
- Heavy stylistic effects in the source (double exposure, ghosting, trails) tend to be read as camera motion rather than subject motion; describe the effect in the downstream prompt as well.
