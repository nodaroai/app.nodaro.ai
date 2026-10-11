# Mask Composite
> Put a foreground video over a background video through a mask video — white shows the foreground, black shows the background. Local FFmpeg, no AI.

## Overview

Mask Composite combines three videos into one: wherever the **mask** is white, you see the **foreground**; wherever it is black, you see the **background**; grey blends the two. Its natural partner is [Video Mask](../ai-video/video-mask.md): mask a subject in its own footage, then use that footage as the foreground and any other video as the background — the subject appears in the new scene.

It is a local, deterministic FFmpeg step — no model, no provider key — so it runs on every edition, including keyless community installs.

**The result follows the foreground:** its size, frame rate and length.
- The **background** is fitted to the foreground's frame (see *Background fit*) and **loops** when it is shorter.
- The **mask** is stretched to the foreground's frame and **holds its last frame** when it is shorter. Near-black (≤ 24 of 255) counts as fully background and near-white (≥ 230) as fully foreground, so compression noise and limited-range encodes never leave a faint ghost.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Invert mask | toggle | off | Swap the sides: black shows the foreground, white the background (e.g. keep everything *except* the subject). |
| Feather | slider | `2` | Edge softening, `0`–`20` px. `0` is a hard edge; a few pixels hide the stair-steps of a tracked mask. |
| Grow / shrink | slider | `0` | Widen (+) or narrow (−) the white region, `-10`–`10` px, before feathering. A negative value trims a halo of the old background around the subject. |
| Background fit | select | `cover` | How the background fills the foreground's frame: `cover` (fill, cropping the overflow), `contain` (fit inside, black bars) or `stretch`. |
| Audio | select | `foreground` | Which sound the result carries: `foreground`, `background`, `mix` (both at equal level) or `none`. A chosen track that does not exist leaves the result silent; `mix` with only one track uses that one. |

## Inputs & Outputs

**Inputs:**
- `video` (labelled **Foreground**) -- the footage whose white-masked region is kept. Required.
- `background-video` (labelled **Background**) -- the video shown where the mask is black. Required.
- `mask-video` (labelled **Mask**) -- the mask video, white = foreground (e.g. Video Mask's output). Required.

**Outputs:**
- `video` -- the composite (H.264 MP4, AAC audio when a track is kept).

## Limits

- Foregrounds up to **300 seconds**.

## Credit Cost

**20 credits per run** (flat — the cost does not vary with length or settings).

## Typical Workflow

```
Upload Video (dance) ──┬───────────────────────────> Mask Composite ─> result
                       └─> Video Mask ("the dancer") ─┘ (mask)   ▲
Upload Video (beach) ───────────────────────────────── (background)
```

See [Video Mask → Typical Workflow](../ai-video/video-mask.md#typical-workflow).

## Notes

- Any black-and-white (or greyscale) video works as the mask, not only Video Mask's — a luma matte from another tool, a rendered shape animation.
- The output is not watermarked (processing nodes never are).
