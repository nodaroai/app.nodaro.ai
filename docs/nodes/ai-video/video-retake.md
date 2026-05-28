# Video Retake

> Replace a time-window slice of an existing video with newly-generated content — audio, video, or both.

## Overview

The Video Retake node takes an upstream video and re-generates a specific time window of it using a text prompt. Unlike Video to Video (which transforms an entire clip) or Extend Video (which appends new footage), Retake performs a **partial replace**: pick a start time and a duration, choose whether to replace the audio track, the visual track, or both, and Retake stitches the new content back into the original clip without re-rendering frames outside the selected window.

Use it for surgical fixes — swap out a few seconds of dialogue, repaint a botched shot, or re-score a specific beat — without re-running the whole generation.

## Provider

Video Retake is powered by **LTX 2.3 Pro** on Replicate. LTX 2.3 Fast does not expose the retake task; only Pro is available at launch.

The dropdown in the node's quick toolbar renders the model as a single locked option so future providers can slot in cleanly without breaking saved workflows.

## Inputs

| Handle | Direction | Accepts | Required | Notes |
|---|---|---|---|---|
| `video` | target | Video producers (Generate Video, Upload Video, Video to Video, Extend Video, ...) | yes | The source clip to retake. The node probes its `duration` on load to size the scrubber. |
| `prompt` | target | Text producers + visual pickers | no | Drives the new content for the selected window. Combined with FieldMappings from connected pickers. |
| `look` | target | Look-family pickers (Setting / Lens / Lighting / Mood / Style / Color Look / Camera Motion / ...) | no | Look-family pickers inject prompt fragments and, where supported, structured camera-motion enums. |

**Output:** a single `video` source handle. The output is a full-length clip — same total duration as the source — with the selected window replaced.

## Controls

The node body shows a visual scrubber over the upstream video preview; the quick toolbar exposes the key levers; the full config panel exposes everything else.

| Control | Surface | Default | Notes |
|---|---|---|---|
| Scrubber | Node body | start `0s`, duration `2s` | Dual-thumb range slider over `[0, videoDuration]`. Thumb A = start, thumb B = start + duration. Min distance: 2s (LTX minimum). |
| Mode | Quick toolbar (3-way segmented) | `replace_audio_and_video` | `replace_audio` (keep visuals, regenerate sound), `replace_video` (keep sound, repaint frames), `replace_audio_and_video` (regenerate both). |
| Aspect ratio | Quick toolbar | Probed from input | `16:9` or `9:16`. Defaults to the upstream video's aspect; user can override. |
| Prompt | Config panel | — | What the new content should be. The prompt only applies to the selected time window. |
| Start time | Config panel | `0` | Seconds. Mirrors thumb A. Bidirectional. |
| Duration | Config panel | `2` | Seconds, minimum `2`. Mirrors `thumb B − thumb A`. Bidirectional. |
| Resolution | Config panel | `1080p` (locked) | Retake is capped at 1080p — the field is shown disabled with a tooltip. |
| FPS | Config panel | `24` | One of `24`, `25`, `48`, `50`. |
| Generate audio | Config panel | `true` | When off, the new visual segment is rendered without a synthesized audio track. Ignored in `replace_audio` mode. |
| Repeat count | Quick toolbar | `1` | Number of variants to generate in parallel. Each variant is independently billed. |

## Credit pricing

Video Retake is metered per second of the retake window. LTX 2.3 Pro on Replicate bills $0.08/sec at 1080p (retake is locked to 1080p); after our standard configured pricing factor at $0.02/credit, that's **5 credits/second**:

```
credits = 5 × retakeDuration × repeatCount
```

**Worked examples:**

| Retake duration | Repeat count | Credits |
|---|---|---|
| 2s | 1 | 10 |
| 4s | 1 | 20 |
| 6s | 1 | 30 |
| 10s | 1 | 50 |
| 4s | 3 | 60 |

The same per-second rate applies to **Extend Video** runs on LTX 2.3 Pro (`credits = 5 × extendDuration`). The runtime table at `/admin/models` (Business / Cloud editions) is the authoritative source — this page is updated whenever the rate changes.

## Notes

- **1080p cap.** Retake output is locked to 1080p regardless of the source video's resolution. If the source is higher than 1080p, the output of the retake window will be 1080p while the surrounding (un-modified) segments retain the source's resolution — for a uniformly 1080p result, run a separate transcode pass.
- **Minimum duration.** The retake window must be at least 2 seconds. The dual-thumb scrubber enforces this client-side; the route rejects shorter windows server-side.
- **Mode semantics:**
  - `replace_audio` — keeps the original visual segment, generates a new audio segment over the window (driven by the prompt). Useful for swapping a voice line, layering an SFX, or re-scoring a beat.
  - `replace_video` — keeps the original audio, regenerates the visual segment over the window. Useful for re-painting a botched shot while preserving sync to the existing soundtrack.
  - `replace_audio_and_video` — regenerates both tracks. The closest equivalent to "re-shoot this scene."
- **Aspect ratio.** Defaults to the probed aspect of the input video; you can override before running. Mismatched aspect produces letterboxing or cropping in the retake window only.
- **No image reference handle.** LTX 2.3's retake API has no image input. Retake is driven by the prompt + look pickers only — wire upstream Character / Location / Style nodes through the `look` handle if you need identity or style continuity.
- **Camera motion.** Wire a Camera Motion picker into `look` to set both LTX's structured `camera_motion` enum (where the catalog entry maps) and a prompt-fragment refinement.

## See also

- [Generate Video](./generate-video.md) — the unified video producer node (LTX 2.3 Pro / Fast both available there for full-clip generation).
- [Extend Video](./extend-video.md) — append (or prepend) new footage to an existing clip. LTX 2.3 Pro extends are billed at the same `5 credits/second` rate as retake.
- [Video to Video](./video-to-video.md) — transform an entire clip (not a time window) with a text prompt.
- [Trim Video](../processing-video/trim-video.md) — for cutting a window out of a clip without regeneration.
