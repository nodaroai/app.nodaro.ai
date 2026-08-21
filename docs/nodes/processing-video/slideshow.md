# Slideshow

> 2–100 images over one optional audio track → MP4 — locally rendered, no AI model, zero credits.

## Overview

The Slideshow node is the N-image companion of [Still to Video](./still-to-video.md): instead of chaining N single-image nodes into Combine Videos, one node takes an ordered set of images and renders the whole sequence — with per-slide motion, transitions, and a timing model anchored to the audio. It runs on the platform's local media engine (FFmpeg) — no provider, no GPU — and costs **0 credits**.

**For a single image, use Still to Video** — same output, no list needed.

## Feeding it images

The `images` input takes an **ordered set**:

- **A List node** — wire its image column and set the edge to **Bundle** ("all items at once"); every row becomes a slide, in row order.
- **Direct connections** — wire 2–100 image nodes straight in; wire order is slide order.

The `transition` input takes the **Transition parameter node** — its pick sets the transition type (mapped onto the local blend vocabulary; unmappable cinematic picks fall back to a hard cut). Nothing wired = cut.

## Timing model

| Case | Behavior |
|------|----------|
| **Audio wired** (primary) | Total duration **is** the audio's duration — never cropped, the video never ends before it. Slides split it equally. |
| **Per-slide overrides** (API/SDK/MCP `imageDurations`) | Pinned rows keep their value; the remainder splits equally across auto rows. |
| **All rows pinned, sum ≠ audio** | Everything scales proportionally to fit the audio, and the applied factor is disclosed on the node and in the job output. |
| **No audio** | Total = N × Per Image (default 3s). The output is **silent** — no audio track at all. |

Transitions consume time from the **outgoing** slide, never the incoming one — so the total duration stays exact.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Per Image | Number (0.5–60s) | 3 | Seconds per slide — used **only when no audio is wired** |
| Transition duration | Number (0–5s) | 0.5 | Blend length; the transition *type* comes from the wired Transition parameter node (unwired = cut) |
| Motion | Select | none | `none`, `zoom-in`, `zoom-out`, `ken-burns`, `alternate` (flips zoom in/out per slide — avoids a uniform mechanical push) |
| Intensity | Number (1–10) | 3 | Motion strength. Ignored when Motion is `none` |
| Resolution | Select | 1080p | `720p`, `1080p`, `4K` |
| Aspect Ratio | Select | 16:9 | `16:9`, `9:16`, `1:1`, `4:3` |
| FPS | Select | 30 | `24` or `30` |
| Fit | Select | cover | `cover` crops each still to fill; `contain` letterboxes with the pad color |
| Pad Color | Color | #000000 | Bar color when Fit is `contain` (disabled otherwise) |

## Credits

**0 credits** — always. No provider cost, no formula, no per-second component.

## Inputs & Outputs

**Inputs:** Images (2–100, ordered — required) · Audio (optional — sets the length) · Transition (optional — the Transition parameter node)
**Outputs:** Video (MP4, H.264; AAC audio when an audio track is wired, silent otherwise)

## Limits

- **Fewer than 2 images** → a clear error pointing at Still to Video.
- **More than 100** → an error rather than an hours-long render; trim the set upstream.

## Best Practices

- `alternate` at intensity 2–4 is the fastest way to make a photo reel feel edited rather than mechanical
- Keep transition duration well under your shortest slide — it blends inside the outgoing slide's time
- With `contain`, the still moves inside the letterbox; the bars stay static
- 4K with motion is the slow path (every slide renders through the motion pipeline); `none` stays fast at any size

## Common Use Cases

- Narrated photo essays: a List of stills + a voiceover track
- Music-backed reels: product shots or event photos over a generated track
- Storyboard animatics: Generate Image outputs in order, dissolves between beats

## Tips

- Chain: Generate Image ×N → List (or direct wires) → Slideshow → Combine Videos to intercut with real footage
- Per-slide durations are available through the API/SDK/MCP (`imageDurations`, `null` = auto); the List node cannot author them yet
- The design treats slide **width as duration** on the node's strip — what you see is the real timing
