# Adjust Speed

> Change video playback speed (0.05x slow-mo to 100x hyper-speed), reverse, time-remap with piecewise segments, with optional motion-compensated frame interpolation.

## Overview

The Adjust Speed (Speed Ramp) node is a pure-FFmpeg post-processor. It changes the playback speed of any input video, optionally reverses it, and optionally interpolates new in-between frames for cinematic slow-motion. For shots that need varying speed across the clip (the classic "normal → slow-mo → normal" action-cam beat), it supports a piecewise time remap defined by start/end/speed segments.

It is distinct from the [Temporal](../parameters/temporal.md) parameter picker — Temporal nudges the AI generator's prompt with motion-character text ("slow motion, reverse playback"), Adjust Speed actually warps the rendered video frames.

## Configuration

| Field        | Type   | Default          | Description                                                                                            |
|--------------|--------|------------------|--------------------------------------------------------------------------------------------------------|
| Speed        | number | `1.0`            | Constant speed factor, 0.05× to 100×. Ignored when `ramps` is non-empty.                              |
| Reverse      | bool   | `false`          | Reverse playback (applied after speed change). Audio is also reversed in pitch-preserve / pitch-shift modes. |
| Audio mode   | enum   | `pitch-preserve` | `pitch-preserve` (natural voice, `atempo` chain), `pitch-shift` (chipmunk/giant, `asetrate`), or `drop`. |
| Frame quality| enum   | `fast`           | `fast` (frame-duplicate via `setpts`, **2 credits**) or `smooth` (motion-compensated `minterpolate`, **5 credits**, ~5-20× slower to render). |
| Ramps        | array  | `[]`             | Piecewise segments — `{ start, end, speed }` tuples in input seconds. Sorted ascending, non-overlapping. Audio is forced to `drop` while ramps are active. |
| adjustAudio  | bool   | -                | **Deprecated.** Legacy field — when present and `audioMode` is unset, `true` maps to `pitch-preserve`, `false` to `drop`. New workflows should use `audioMode`. |

## Inputs & Outputs

**Inputs:**
- `in` (required) — Video to speed-adjust.

**Outputs:**
- `video-out` — Speed-adjusted (and optionally reversed / interpolated / ramped) MP4.

## How it works

| Setting | FFmpeg primitive |
|---|---|
| Constant speed | `setpts=PTS/speed` (video) + chained `atempo` (audio) |
| Reverse | `reverse` + `areverse` |
| Pitch-shift audio | `asetrate=44100*speed,aresample=44100` |
| Smooth frames | `minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir` |
| Ramps | Piecewise `setpts` expression — output PTS at input time T is the cumulative output duration of all earlier segments plus `(T - start[k]) / speed[k]` for the segment containing T |

The setpts expression for ramps is built in `backend/src/providers/video/speed-ramp.ts::buildRampSetptsExpression`. Test coverage lives in `__tests__/speed-ramp-expr.test.ts`.

## Credit pricing

| Mode | Credits |
|---|---|
| `fast` (default) | **2** |
| `smooth` | **5** |

Composite credit identifier: `speed-ramp:smooth` when `quality === "smooth"`, otherwise `speed-ramp`. Both are seeded in `STATIC_CREDIT_COSTS` and the route's `creditGuard` dispatches based on the request body.

The 5 cr smooth-mode price is a flat ~2.5× of fast. Real CPU time is closer to 5-20×, so heavy use should be monitored via the credit-anomaly audit (`/admin/credit-anomalies`).

## Best Practices

- **Slow-motion**: 0.5× with `quality: smooth` looks the closest to "240 fps shoot" — frame-duplicate at the same speed looks choppy.
- **Time-lapse / hyperlapse**: 4-10× with `quality: fast`, `audioMode: drop`.
- **Reverse**: pair with a non-zero speed change for dynamic moments (e.g. `speed: 2`, `reverse: true` = fast rewind).
- **Pitch-preserved audio**: keeps dialogue intelligible at moderate speed changes (0.7× – 1.5×). For voiceover narration, prefer `pitch-preserve`.
- **Pitch-shift audio**: chipmunk-voice effect at high speed, giant-voice at low — useful for comedic/character moments.
- **Ramps**: use 2-3 segments for a classic action-cam beat — e.g. `{0,1,1.0}, {1,3,0.25}, {3,5,1.0}` slows down the middle two seconds of a 5-second clip.

## Limitations

- **No per-segment audio time-stretch.** When `ramps` is set, audio is dropped. Cinematic speed-ramp shots typically swap in music post-hoc; the worker enforces this in `resolveAudioMode`.
- **Smooth-mode cost.** `minterpolate=mi_mode=mci` is CPU-expensive. The flat 5-credit price is a deliberate undercharge to encourage experimentation; revisit when usage data is available.
- **No GPU acceleration.** FFmpeg `minterpolate` runs on CPU only. For batch slow-motion at scale, an external service (e.g. Topaz, RIFE) would be required — those would be separate node types.
- **No `rubberband` audio time-stretch.** Higher-quality audio time-stretch via librubberband would require a custom FFmpeg build.

## Common Use Cases

- Slow-motion highlights from action footage (e.g. 0.5× + smooth).
- Time-lapse / hyperlapse compression (e.g. 8× + fast + drop audio).
- Reverse shots for psychological / sci-fi sequences.
- Speed ramps for music-video transitions (normal → slow-mo at the drop → normal).
- Pacing adjustment for AI-generated video clips that feel too fast or too slow.

## Tips

- Below 0.5×, `fast` mode shows visible frame holds; `smooth` is strongly recommended for slow-motion below 0.7×.
- Above 10×, the file gets very short — pair with [Loop Video](./loop-video.md) if you need it longer.
- Chain with [Trim Video](./trim-video.md) when you want to speed-adjust only a section.
- For audio-only speed changes, this node still works — just wire a video input that has the audio track on it. Audio-only speed changes via a dedicated audio node may come later.

## See Also

- [Temporal](../parameters/temporal.md) — parameter picker that nudges AI generators with motion-character text.
- [Loop Video](./loop-video.md) — repeat a clip N times or to a target duration.
- [Trim Video](./trim-video.md) — cut a section out before/after speed-adjusting.
- [Combine Videos](./combine-videos.md) — chain speed-adjusted clips together.
