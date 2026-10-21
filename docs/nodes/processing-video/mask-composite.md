# Mask Composite
> Put a foreground video over a background video through a mask video — white shows the foreground, black shows the background. Local FFmpeg, no AI.

## Overview

Mask Composite combines three videos into one: wherever the **mask** is white, you see the **foreground**; wherever it is black, you see the **background**; grey blends the two. Its natural partner is [Video Mask](../ai-video/video-mask.md): mask a subject in its own footage, then use that footage as the foreground and any other video as the background — the subject appears in the new scene.

It is a local, deterministic FFmpeg step — no model, no provider key — so it runs on every edition, including keyless community installs.

**The result follows the foreground:** its size, frame rate and length.
- The **background** is fitted to the foreground's frame (see *Background fit*) and **loops** when it is shorter.
- The **mask** is stretched to the foreground's frame and **holds its last frame** when it is shorter. Near-black (≤ 24 of 255) counts as fully background and near-white (≥ 230) as fully foreground, so compression noise and limited-range encodes never leave a faint ghost.

**Pixelate and Blur** (see *Fill*) need no foreground: the masked area shows the **background itself**, pixelated or blurred — to hide faces, plates or screens in a clip, with the mask from Video Mask. Then:
- the result follows the **background**: its size, frame rate and length (*Background fit* has nothing to fit, and the background does not loop);
- the Foreground input is not used — it shows muted on the node, and a video wired into it is ignored;
- the result always carries the background's sound, the only track there is (the *Audio* setting is hidden and ignored).

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Fill | select | `video` | What fills the masked area: `video` (the foreground), `pixelate` (the background in square blocks) or `blur` (the background blurred). Pixelate and Blur take no foreground. |
| Block size (% of width) | slider | `1.25%` | Pixelate only: the block size as a share of the video's width, `0.2`–`10` %, so it looks the same at any resolution. Blocks are `max(2, round(width × % ÷ 100))` px — `1.25%` is 16 px on a 1280-wide video, 24 px on 1920. Each block is the average colour of the pixels it covers. The API takes it as `pixelSizePct`. |
| Blur strength (% of width) | slider | `2%` | Blur only: `0.1`–`5` %. A gaussian blur whose sigma is that share of the video's width — `2%` is sigma 25.6 px on a 1280-wide video, 38.4 px on 1920. The API takes it as `blurStrengthPct`. |
| Invert mask | toggle | off | Swap the sides: black shows the foreground, white the background (e.g. keep everything *except* the subject). |
| Feather | slider | `2` | Edge softening, `0`–`20` px. `0` is a hard edge; a few pixels hide the stair-steps of a tracked mask. |
| Grow / shrink | slider | `0` | Widen (+) or narrow (−) the white region, `-10`–`10` px, before feathering. A negative value trims a halo of the old background around the subject. |
| Opacity | slider | `100%` | How strongly the fill covers the background inside the mask, `0`–`100` %: at `100%` the fill (the foreground, or the pixelated / blurred background) replaces the background there; below it the two blend (`opacity × fill + (1 − opacity) × background`). Outside the mask is always the background. The API takes it as `opacity`, `0`–`1`. |
| Background fit | select | `cover` | How the background fills the foreground's frame: `cover` (fill, cropping the overflow), `contain` (fit inside, black bars) or `stretch`. Hidden with Pixelate or Blur (the background is the frame). |
| Audio | select | `foreground` | Which sound the result carries: `foreground`, `background`, `mix` (both at equal level) or `none`. A chosen track that does not exist leaves the result silent; `mix` with only one track uses that one. Hidden with Pixelate or Blur; there the result always carries the background's sound, whatever `audioSource` says. |

## Inputs & Outputs

**Inputs:**
- `video` (labelled **Foreground**) -- the footage whose white-masked region is kept. Required with the `video` fill; unused (and optional) with Pixelate or Blur.
- `background-video` (labelled **Background**) -- the video shown where the mask is black. Required.
- `mask-video` (labelled **Mask**) -- the mask video, white = foreground (e.g. Video Mask's output). Required.

**Outputs:**
- `video` -- the composite (H.264 MP4, AAC audio when a track is kept).

## Limits

- Foregrounds up to **300 seconds** (with Pixelate or Blur, backgrounds up to 300 seconds).

## Credit Cost

**11 credits<!-- credits-rate: mask-composite --> per started 5 seconds of the result** (the foreground's length — the background's with Pixelate or Blur), the run's units priced together as one charge — the node's price row is one 5-second unit.

| Result length | Units | Credits |
|---|---|---|
| 3 s | 1 | 11<!-- credits: mask-composite --> |
| 10 s | 2 | 22<!-- credits: mask-composite@2 --> |
| 61 s | 13 | 143<!-- credits: mask-composite@13 --> |
| 5 minutes | 60 | 660<!-- credits: mask-composite@60 --> |

**Formula:** credits = 10 × ceil(foreground seconds ÷ 5), at least 10 (with Pixelate or Blur, the background's seconds). The route measures that video before anything is charged (unreadable → `invalid_video_duration`, over 300 s → `video_duration_exceeds_limit`). Before a run, a foreground whose length the graph does not tell shows the range **10–600** on the node, and a workflow estimate counts 600.

## Typical Workflow

```
Upload Video (dance) ──┬───────────────────────────> Mask Composite ─> result
                       └─> Video Mask ("the dancer") ─┘ (mask)   ▲
Upload Video (beach) ───────────────────────────────── (background)
```

See [Video Mask → Typical Workflow](../ai-video/video-mask.md#typical-workflow).

Blurring a subject in place (Fill: Blur — no foreground):

```
Upload Video (street) ──┬─────────────────────────────> Mask Composite (Blur) ─> result
                        └─> Video Mask ("the faces") ──┘ (mask)
                          (the street video also goes into Background)
```

## Notes

- Any black-and-white (or greyscale) video works as the mask, not only Video Mask's — a luma matte from another tool, a rendered shape animation.
- The output is not watermarked (processing nodes never are).
