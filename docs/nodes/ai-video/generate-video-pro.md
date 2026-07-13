# Generate Video Pro

> Long-form video generation. Requests above a single segment's limit are automatically split into multiple Seedance 2 segments and stitched into one seamless clip. Cloud edition only.

## Overview

Generate Video Pro is a specialized, Seedance-2-family-only sibling of [Generate Video](./generate-video.md), built for one thing: clips longer than a single provider call can produce. Ask for a duration beyond the single-segment limit (15 seconds) and the node transparently generates multiple segments in sequence — each one continuing from where the last left off — and stitches them into a single output video.

Below that limit, Generate Video Pro behaves exactly like a normal single-shot Seedance 2 run and is priced the same way. Use it when you need one continuous clip longer than 15 seconds; use [Generate Video](./generate-video.md) for everything else (shorter clips, other providers, first+last frame, video-to-video, or the full multimodal reference/prompt-token surface).

**Cloud edition only.** Generate Video Pro requires a Cloud subscription.

## Input handles

| Handle | Direction | Accepts | Notes |
|---|---|---|---|
| `prompt` | target | Text producers + visual pickers | Main prompt, carried into every segment |
| `startFrame` | target | Image producers | Opening frame for the first segment |
| `imageReferences` | target | Image producers (ordered, multi) | Reference images carried into generation |
| `video` | source | n/a | Output — the final stitched video |

Generate Video Pro exposes a trimmed handle set compared to Generate Video — no `endFrame`, `videoReferences`, `audioReferences`, `audio`, or `negative` handles, and none of the picker clusters (`assets` / `look` / `elements`).

## Configuration

| Field | Type | Default | Notes |
|---|---|---|---|
| Provider | Select | `seedance-2` | `seedance-2` (full), `seedance-2-fast`, `seedance-2-mini` — Seedance-2-family only |
| Prompt | Text | — | Describes the video; also settable via the `prompt` handle |
| Duration | Number (4–cap) | 8s | Minimum 4s. Maximum is the configured cap (120s by default) — see [Duration cap](#duration-cap) |
| Aspect Ratio | Select | `adaptive` | 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9 / Adaptive (matches the wired input) |
| Resolution | Select | `720p` | By provider — see [Providers](#providers) |
| Generate Audio | Checkbox | on | |

## Providers

Generate Video Pro is scoped to the Seedance 2 family:

| Provider | Label | Resolutions |
|---|---|---|
| `seedance-2` | Seedance 2.0 | 480p / 720p / 1080p / 4K |
| `seedance-2-fast` | Seedance 2.0 Fast | 480p / 720p only |
| `seedance-2-mini` | Seedance 2.0 Mini | 480p / 720p only |

For the full Seedance 2 capability write-up (multimodal image/video/audio references, `{image:N}`-style prompt tokens, unified frames+references wiring) see [Generate Video → Providers](./generate-video.md#providers). Generate Video Pro forwards `startFrame` and `imageReferences` into generation, but exposes none of that page's richer reference/token surface.

## How segmentation works

A request at or below 15 seconds runs as a single segment — identical in shape to a normal [Generate Video](./generate-video.md) Seedance 2 run.

A request above 15 seconds is automatically split into multiple segments (each 4–15s), generated in sequence and stitched into one output:

- The **first segment** starts from the wired `startFrame` (if any) and the prompt.
- Every **later segment** continues seamlessly from the final frames of the one before it, so the stitched result reads as one continuous shot.
- Segment count and individual lengths are chosen automatically to cover the requested duration (with a small amount of per-join overlap reserved for a seamless stitch) — they are not user-configurable.

## Credit pricing

### Single segment (≤ 15s)

Billed via the same per-second Seedance 2 composite identifiers Generate Video uses (`seedance-2:<N>s:<resolution>`) — see Generate Video's [Seedance 2 pricing table](./generate-video.md#credit-pricing) for the full per-resolution rate ladder and worked examples.

**One difference from Generate Video:** a single-segment Generate Video Pro run is always billed at the no-reference rate, even when a start frame or reference images are wired. The cheaper `-ref` rate only ever applies to later segments of a multi-segment run (see below), where it reflects a segment continuing from the previous segment's frames — not to user-wired references.

### Multi-segment (> 15s)

```
reserve = 10 (fee) + ceil(noRefPerSec × 15) + ceil(refPerSec × ((N − 1) × 1 + (S − 15)))
```

- **10** — flat fee covering the segmentation/stitch overhead, charged once per run regardless of segment count.
- **noRefPerSec** / **refPerSec** — the same per-second Seedance 2 rates Generate Video's single-segment pricing uses. At 720p these are **10.25** and **6.25** credits/sec; see Generate Video's [Seedance 2 pricing table](./generate-video.md#credit-pricing) for the 480p / 1080p / 4K rates.
- **15** — the per-segment maximum. The first segment is always reserved at the full 15s cap, even when its actual length ends up shorter (see the worked example below).
- **N** — the number of segments the request splits into.
- **S** — the combined length (seconds) of all segments, which runs slightly longer than the requested duration to cover the per-join overlap needed for a seamless stitch.
- **`(N − 1) × 1`** — one second of overlap per join, billed at the reference rate (each joining segment continues from the previous one's final frames).

#### Worked examples (720p, `seedance-2`)

| Requested duration | Mode | Segments | Total length (S) | Reserved credits |
|---:|---|---:|---:|---:|
| 8s | single | 1 | 8s | 82 |
| 15s | single | 1 | 15s | 154 |
| 16s | multi | 2 | 17s | 183 |
| 43s | multi | 3 | 44s | 358 |
| 60s | multi | 5 | 62s | 483 |
| 120s | multi | 9 | 123s | 889 |

**60-second example, in full.** A 60-second request splits into 5 segments (14s, 12s, 12s, 12s, 12s — totaling 62s). Reserved at job start: `10 + ceil(10.25 × 15) + ceil(6.25 × (4 × 1 + 47)) = 10 + 154 + 319 = 483` credits. If all 5 segments complete, the commit re-prices the first segment at its actual length (14s, not the reserved 15s cap): `10 + ceil(10.25 × 14) + ceil(6.25 × (4 × 1 + 48)) = 10 + 144 + 325 = 479` credits — **4 credits refunded**. Credits are only ever refunded at commit, never charged above the reservation.

### Partial delivery

If a run is interrupted before every planned segment finishes, the segments that completed are kept and billed — the delivered video ends at the last successfully generated segment, shorter than requested, rather than failing outright. Credits reserved for segments that never ran are refunded. An individual segment's generation attempt that fails and is retried internally is never billed for the retry itself — only segments that make it into the final stitched video count toward the charge.

### Interruption recovery

Long multi-segment runs checkpoint their progress after every segment. If the processing worker restarts mid-run (for example during a platform deploy), the run resumes automatically from the checkpoint — already-generated segments are never re-generated or re-billed, and a run that had finished generating resumes straight at the final stitch. Only a run that stalls *again* after its automatic resume is failed and refunded.

### Duration cap

The maximum requestable duration defaults to **120 seconds**; self-hosted deployments can raise or lower it via the `GENERATE_VIDEO_PRO_MAX_DURATION` environment variable. `GET /v1/nodes` reports the active cap for this node. Requests above the cap are clamped down to it before segmentation runs.

## Best practices

- Stay under 15 seconds and use [Generate Video](./generate-video.md) instead when you don't need a stitched multi-segment clip — it's cheaper (no fee-base) and gives you the full Seedance 2 reference/prompt-token surface.
- Wire a `startFrame` to anchor the opening shot; without one, the first segment is driven by the prompt alone.
- Keep the prompt generally applicable across the whole requested duration — it's reused for every segment, not just the first.
- Longer requests take proportionally longer to generate (segments run in sequence, not in parallel) — plan for wall-clock time, not just credits.

## See also

- [Generate Video](./generate-video.md) — for single-shot clips, other providers, first+last frame, or the full Seedance 2 reference/prompt-token surface.
