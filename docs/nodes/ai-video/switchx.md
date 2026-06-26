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
| Seed | Number | — | Reproducibility seed (0–4,294,967,295); leave empty for random |

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
| **Beeble SwitchX** (`beeble-switchx`) | Source ≤ 240 frames (~8s; a clip a little over is auto-trimmed — see Tips) and ≤ 2,770,000 px (≈1080p); MP4/MOV (H.264/HEVC). |

A "Powered by SwitchX" attribution is shown alongside the output, per Beeble's brand requirements.

## Credit cost

Cost scales with the clip's length in **30-frame blocks × output resolution** — the same unit the provider meters in (≈1 second per block at 30fps). The node reserves the block bucket before the run.

Per 30-frame block: **5 credits at 720p, 15 credits at 1080p.**

| Length | 720p | 1080p |
|--------|------|-------|
| ≤ 30 frames (~1s) | 5 | 15 |
| ≤ 60 frames (~2s) | 10 | 30 |
| ≤ 90 frames (~3s) | 15 | 45 |
| ≤ 120 frames (~4s) | 20 | 60 |
| ≤ 150 frames (~5s) | 25 | 75 |
| ≤ 180 frames (~6s) | 30 | 90 |
| ≤ 210 frames (~7s) | 35 | 105 |
| ≤ 240 frames (~8s) | 40 | 120 |

A clip is billed by the number of 30-frame blocks it spans — e.g. a 144-frame 1080p clip spans 5 blocks → 75 credits. The editor shows a typical-length estimate; the exact charge is computed from the clip's real frame count when the job runs. The platform's standard markup (if any) is applied at reserve, the same as every other node.

## Best Practices

- **Always connect a reference image** when you can — it's the single biggest quality lever.
- Keep the source short (~8s / ≤ 240 frames). A clip just over the cap (up to ~270 frames / ~1s) is **auto-trimmed** to fit and billed at the 240-frame tier; a clip well over is rejected — trim those yourself first to pick the segment you want.
- Start with **Auto** mode (no mask needed) for relight / background-swap; reach for **Select**/**Custom** only when you need precise control over what's kept.
- For **Select** mode, the easiest mask source is the **Generate Mask** node ("mask the person") wired into the Mask input.

## Common Use Cases

- Relight a subject to match a new environment or time of day
- Swap or restyle a background while keeping the subject's motion and identity
- Composite new elements into a scene driven by a reference image
- Precise element replacement using a painted or generated mask

## Tips

- **Auto** and **Fill** need no mask; **Select** needs a single keyframe mask image; **Custom** needs a full alpha matte video.
- For **Select** mode, the easiest way to make the mask is the **Generate Mask** node ("mask the person") wired into the Mask input — SwitchX then propagates that one-frame mask across the whole clip. Beeble has no separate alpha-generation API; `Auto` does the masking for you, and `Select`/`Custom` take a mask you supply.
- Output URLs are re-hosted to your library automatically — there's no 72-hour expiry to worry about.
- Start from a **preset** (Relight Subject, Swap Background, Restyle Scene, …) for a tuned starting point, then adjust the prompt and reference.
- Set a **Seed** to make a result repeatable across runs with the same inputs; leave it empty for a fresh variation each time.
