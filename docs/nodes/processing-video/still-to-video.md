# Still to Video

> Turn one still image + one audio track into an MP4 — locally rendered, no AI model, zero credits.

## Overview

The Still to Video node is the non-AI bridge from a still image into the video pipeline. Wire an image and an audio track; the node renders an MP4 whose length **is the audio's length** — there is no duration field anywhere on the node. An optional motion preset (zoom, pan, or Ken Burns) animates the still; with motion set to `none` the render is a fast static frame.

It runs on the platform's local media engine (FFmpeg) — no provider, no GPU — and costs **0 credits**.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Motion | Select | none | `none`, `zoom-in`, `zoom-out`, `pan-left`, `pan-right`, `ken-burns` |
| Intensity | Number (1–10) | 3 | How strong the motion is — subtle (1) to strong (10). Ignored when Motion is `none` |
| Resolution | Select | 1080p | `720p`, `1080p`, `4K` (names the short edge; the long edge follows the aspect) |
| Aspect Ratio | Select | 16:9 | `16:9`, `9:16`, `1:1`, `4:3` |
| FPS | Select | 30 | `24` or `30` |
| Fit | Select | cover | `cover` crops the still to fill the frame; `contain` letterboxes it with the pad color |
| Pad Color | Color | #000000 | Bar color when Fit is `contain` (disabled otherwise) |

## Credits

**0 credits** — always. There is no provider cost behind this node; it renders locally. No formula, no per-second component, no resolution multiplier.

## Inputs & Outputs

**Inputs:** Image (required) · Audio (required — sets the output length)
**Outputs:** Video (MP4, H.264 + AAC)

## Duration

The output duration equals the wired audio's duration, resolved automatically when the render starts. A render fails with a clear error (rather than producing a silent or zero-length file) if the audio's duration can't be read.

## Best Practices

- Feed a still at (or above) the output resolution — the node never upscales your image's detail, it only frames it
- `cover` is right for full-bleed footage; use `contain` + a pad color when the whole image must stay visible (posters, artwork, documents)
- Ken Burns at intensity 2–4 reads as "documentary"; 7+ reads as deliberate motion graphics
- With motion on `contain`, the still moves inside the letterbox — the bars stay static

## Common Use Cases

- Narrated slides: a generated image + a voiceover → a ready video segment
- Podcast/music visualizers: cover art + the track → an uploadable MP4
- Photo moments inside a longer edit — feed the result into Combine Videos
- Turning any Generate Image output into video without spending video-model credits

## Tips

- Chain: Generate Image → Still to Video → Combine Videos to intercut stills with AI footage
- The audio input accepts anything that produces audio — Text to Speech, Generate Music, an upload, or an extracted track
- 4K with motion is the slowest path; at `none` even 4K renders quickly
