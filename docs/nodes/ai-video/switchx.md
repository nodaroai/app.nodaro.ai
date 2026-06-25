# Relight & Switch

> Relight a video and switch/composite elements, driven by the original pixels. Powered by Beeble SwitchX.

## Overview

Unlike a normal video generator, **Relight & Switch** is driven by your **source video's own pixels**. You provide the source video, an **alpha mask** (what to keep), and a **reference image and/or text prompt** (the new look). SwitchX generates the new elements and **relights the kept subject to match** — so the same node covers relighting a subject, swapping or restyling a background, and compositing new elements in, depending on the reference and the alpha mode you choose.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Mode | Select | Auto | How the alpha mask is derived (see **Alpha modes** below) |
| Prompt | Textarea | — | Text description of the desired output (a connected reference image is strongly recommended) |
| Keyframe index | Number | 0 | *Select mode only* — 0-based frame your mask describes; the AI propagates it across the clip |
| Resolution | Select | 1080p | 720p or 1080p output |
| Seed | Number | — | Seed for reproducible results (near-identical, not bit-exact) |

### Alpha modes

| Mode | Mask input | What it does |
|------|-----------|--------------|
| **Auto** | none | The AI detects and masks the foreground subject — relight it, restyle/replace the background. |
| **Fill** | none | Keeps the whole scene — restyle the entire frame from your reference/prompt. |
| **Select** | one keyframe **image** | Provide a grayscale mask for a single reference frame; the AI propagates it across the video. |
| **Custom** | full **matte video** | Provide a per-frame alpha matte video for frame-accurate control. |

## Inputs & Outputs

**Inputs:**
- **Source video** (required) — the video to transform
- **Reference image** (optional, strongly recommended) — your visual target / "new look"
- **Mask** (Select mode) — a grayscale keyframe mask image
- **Mask video** (Custom mode) — a full per-frame alpha matte video
- **Text Prompt** (optional) — from an upstream node

**Outputs:**
- Relit / recomposited video URL

## Provider

| Provider | Notes |
|----------|-------|
| **Beeble SwitchX** (`beeble-switchx`) | Source ≤ 240 frames and ≤ 2,770,000 px (≈1080p); MP4/MOV (H.264/HEVC). |

A "Powered by SwitchX" attribution is shown alongside the output, per Beeble's brand requirements.

## Credit cost

Cost scales with the clip's **frame count × output resolution**. The node reserves a frame-tier bucket before the run.

> **Provisional pricing** — the values below are deliberate worst-case placeholders and are recalibrated against the provider's real per-frame cost after launch. Credits are reserved at the tier ceiling for your clip's length.

| Frame tier | 720p | 1080p |
|-----------|------|-------|
| ≤ 48 frames | 22 | 36 |
| ≤ 96 frames | 44 | 72 |
| ≤ 144 frames | 65 | 108 |
| ≤ 192 frames | 87 | 144 |
| ≤ 240 frames | 108 | 180 |

A clip is snapped **up** to the next tier (e.g. a 90-frame 1080p clip reserves the ≤96/1080p tier = 72). The platform's standard markup is applied at reserve, the same as every other node.

## Best Practices

- **Always connect a reference image** when you can — it's the single biggest quality lever.
- Keep the source short (≤ 240 frames; trim longer clips first — the node rejects oversize sources).
- Start with **Auto** mode (no mask needed) for relight / background-swap; reach for **Select**/**Custom** only when you need precise control over what's kept.
- For **Select** mode, the easiest mask source is the **Generate Mask** node ("mask the person") wired into the Mask input.

## Common Use Cases

- Relight a subject to match a new environment or time of day
- Swap or restyle a background while keeping the subject's motion and identity
- Composite new elements into a scene driven by a reference image
- Precise element replacement using a painted or generated mask

## Tips

- **Auto** and **Fill** need no mask; **Select** needs a single keyframe mask image; **Custom** needs a full alpha matte video.
- Output URLs are re-hosted to your library automatically — there's no 72-hour expiry to worry about.
- Reuse the same **Seed** with identical inputs for consistent iterations.
