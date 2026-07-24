# Combine Videos

> Concatenate multiple video clips with transitions and per-clip frame trim.

## Overview

The Combine Videos node joins multiple video clips in sequence with configurable transitions between them. Supports drag-and-drop reordering of connected clips and per-clip head/tail frame trimming. All processing is done via FFmpeg.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Transition | Select | fade | Transition type between clips |
| Transition Duration | Number | 0.5 | VIDEO transition length in seconds (0.1-2s), hidden for "cut" |
| Audio Mode | Select | crossfade | How to handle audio during transitions |
| Crossfade Duration | Number | 0.5 | AUDIO-only crossfade length (0-5s, shown when Audio = Crossfade). Never affects the video. Falls back to Transition Duration on older workflows. |
| Crossfade Curve | Select | linear | Audio fade curve (shown when Audio = Crossfade) |
| Boundary Cut | Select | manual | How each clip-to-clip boundary is cut. **Manual** trims an exact number of frames (fields below). The **Smart** methods (**Nodaro Cloud only**) find the cut automatically: `best-pair` (the single most similar frame pair), `preroll-keep-next` or `preroll-keep-prev` (replay-diagonal detection — see below). Manual and Smart are alternatives, not layers |
| Smart: prev window | Number | 8 | Frames searched at the END of each clip (1-24, shown for Smart methods) |
| Smart: next window | Number | 8 | Frames searched at the START of the following clip (1-24) |
| Trim Start Frames | Number | 1 | **Manual method only.** Frames trimmed from the start of EACH clip except the first (0-120). Default 1 drops the duplicated boundary frame AI continuation clips carry |
| Trim End Frames | Number | 2 | **Manual method only.** Frames trimmed from the end of EACH clip except the last (0-120). Default 2 drops boundary generation artifacts |
| Clip Ordering | Drag list | — | Reorder connected video clips |

### Transition Options

50+ FFmpeg `xfade` transitions are available, organized into a tabbed picker in the config panel. The **Common** tab surfaces the most-used handful; the remaining tabs group every option by family. Each tile shows a looping mini-preview so you can compare options at a glance.

**Common tab** — the everyday handful:

| Transition | Description |
|------------|-------------|
| cut | Hard cut — instant switch, no blend. Fastest. |
| fade | Smooth alpha cross-fade. Classic clean blend. |
| dissolve | Random-pixel dissolve. Grainy, organic feel — good for memory beats. |
| dip-to-black | Fade through black. Use between scenes or time jumps. |
| dip-to-white | Fade through white. Bright, ethereal — flashbacks. |
| wipe-left, wipe-right | Hard edge sweeps across the frame. |
| slide-left, slide-right | Next clip pushes the current one off-screen. |
| circle-open | Circular iris opens to reveal the next clip from center. |

**All groups** — full catalog (id → FFmpeg xfade name):

| Group | Transitions |
|-------|-------------|
| Fades & Dips | cut (concat), fade, dissolve, dip-to-black (fadeblack), dip-to-white (fadewhite), fadegrays |
| Wipes | wipe-left, wipe-right, wipe-up, wipe-down, wipe-tl, wipe-tr, wipe-bl, wipe-br |
| Slides | slide-left, slide-right, slide-up, slide-down |
| Smooth | smooth-left, smooth-right, smooth-up, smooth-down (feathered-edge wipes) |
| Shapes | circle-open, circle-close, circle-crop, rect-crop, horz-open, horz-close, vert-open, vert-close, diag-tl, diag-tr, diag-bl, diag-br |
| Slices | hl-slice, hr-slice, vu-slice, vd-slice |
| Reveals | reveal-left, reveal-right, reveal-up, reveal-down |
| Covers | cover-left, cover-right, cover-up, cover-down |
| Effects | pixelize, radial, hblur, distance, zoom-in, squeeze-h, squeeze-v |

**Back-compat note:** Workflows saved with the old 5-value transition field (`cut` / `fade` / `dissolve` / `dip-to-black` / `dip-to-white`) keep working. `dip-to-black` and `dip-to-white` now use FFmpeg's built-in `fadeblack` / `fadewhite` xfade transitions instead of interleaving generated solid-color clips — visually identical, one fewer ffmpeg pass per dip. `dissolve` now produces the FFmpeg `dissolve` xfade (pixel-noise pattern), which differs subtly from `fade` — previously the two were aliased.

### Audio Modes

- **keep** — Preserve original audio from each clip
- **crossfade** — Blend audio during transition (curve configurable, see below)
- **remove** — Strip all audio from output

**The audio crossfade never influences the video.** Its duration and curve shape only the soundtrack: at a cut the video stream is copied byte-for-byte (identical whether crossfade is on or off), and at blend transitions the video fade length is governed solely by Transition Duration.

**How crossfade behaves per transition type:**

- **Cut (or any transition at duration 0):** the video switches instantly, and the audio does an **L-cut**: each incoming clip's sound starts exactly ON its cut (in sync, fading in), while the outgoing clip's sound lingers `d` seconds past the cut and fades out over it — a true blend with no dropout. The lingering tail comes from stretching the outgoing audio a few percent (pitch-preserved), which is masked under the fade. The **last clip is untouched**: its sound runs to the very end of the video, no fade-out.
- **Blend transitions (fade, dissolve, wipes, …):** every clip's audio stays anchored to its video start — no drift, regardless of the audio crossfade length. The fades cross-blend over the video overlap; an audio crossfade *longer* than the video fade simply extends the blend gently into both clips. The last clip's audio is never faded out.

**Audio normalization:** every clip is re-encoded to a common format before joining (24fps H.264, AAC 44.1kHz stereo), so clips from different providers — which often ship different sample rates — always splice cleanly. If some clips have audio and others are silent, the silent clips get a silent audio track injected so the combined track never drops out mid-video.

### Smart Cut

> **Nodaro Cloud only.** Smart Cut's boundary-matching algorithms run from Nodaro's cloud engine; self-hosted Community and Business editions offer the exact frame trims (`Trim Start/End Frames`) instead, and the API returns `cloud_only_feature` if `smartCutEnabled` is requested there.

For continuation clips (each generated from the previous clip's last frame), the seam usually stutters because the models re-render a near-identical moment on both sides. **Smart Cut** searches the last *N* frames of each clip and the first *M* frames of the next (PSNR similarity at 24dB) and places the cut with the chosen **method** — all three share the same windows and the same fixed-trims fallback; only the algorithm that picks the cut point differs:

- **Best pair** (default): cut at the single most similar frame pair — the first clip ends **on** the best match, the next starts **right after** its twin, so the shared moment plays exactly once. Byte-identical to the node's pre-method behavior.
- **Pre-roll keep-next**: some continuation models restart *before* the boundary frame and **re-enact the previous clip's last frames** before diverging (a replay). This method detects the replay as a *diagonal run* of matching pairs and cuts where the replay **starts** — the whole overlap plays from the *next* clip's copy, moving the seam away from the fragile replay-to-new-content zone.
- **Pre-roll keep-prev**: detects the same replay but cuts where it **ends** — the *previous* clip's original (often sharper) frames are kept and the next clip drops its whole re-enactment.

**Match threshold + fallback:** a pair only counts as a genuine match above **24dB** PSNR (measured: continuation twins ≥ ~28dB, unrelated clips ≤ ~15dB); the pre-roll methods additionally require a contiguous run of at least 2 matching pairs (an isolated pair is noise, not a replay — a lone anchor twin at the exact boundary still drops the single duplicate). Boundaries with a match use the method's cut; boundaries **without** one (clips that don't actually continue each other, or a failed search) fall back to the **default trims** (start 1 / end 2). Custom trim values belong to the Manual method only — switching to a Smart method resets them, so nothing hidden steers the fallback.

**Every junction is searched independently** — with 3 clips there are 2 boundaries, each with its own result. The applied values are reported in the job's `output_data.smartCuts`:

```json
"smartCuts": [
  { "boundary": 0, "prevClipEndTrimFrames": 0, "nextClipStartTrimFrames": 1, "psnrDb": 30.19, "matched": true, "searchedPrevFrames": 8, "searchedNextFrames": 8 },
  { "boundary": 1, "prevClipEndTrimFrames": 2, "nextClipStartTrimFrames": 1, "psnrDb": 11.7, "matched": false, "searchedPrevFrames": 8, "searchedNextFrames": 8 }
]
```

`boundary` k is the join between clip k and clip k+1. Every pair in the `searchedPrevFrames` × `searchedNextFrames` grid is compared (the requested windows, clamped to short clips). The trim fields are the values actually **applied** (drop counts: `prevClipEndTrimFrames: 0` = the match was the previous clip's very last frame, kept; `nextClipStartTrimFrames: 1` = the next clip dropped just its duplicated first frame). `matched: false` means no pair cleared the threshold — the reported values are the fixed trims the boundary fell back to. `psnrDb`: >30 ≈ visually identical, 100 = pixel-identical, `null` = the search errored.

### Crossfade Curve (only when Audio = Crossfade)

| Curve | FFmpeg `acrossfade=curve=` | When to use |
|-------|----------------------------|-------------|
| Linear | `tri` | Default — predictable but can dip in the middle for music |
| Equal Power | `qsin` | Keeps perceived loudness roughly constant — best for music |
| Smooth (Sine) | `hsin` | Gentler than equal-power — good for dialogue and ambient |
| Logarithmic | `log` | Compensates for the ear's logarithmic loudness response; long, slow tails |
| Exponential | `exp` | Sharp out / slow in — punchy, good for impact moments |

## Inputs & Outputs

**Inputs:** 2+ video clips (connected via input handles)
**Outputs:** Single combined video

## Credit Cost

Combine Videos is **dynamically priced** based on output length and input count:

- **Base:** 1 credit per 5 seconds of estimated output length (sum of upstream durations, minus crossfade overlaps, minus per-clip frame trim)
- **Input adder:** +1 credit per extra input beyond the first 2
- **Floor:** minimum 1 credit

The estimator walks back through the connected upstream nodes to read each clip's duration. When an upstream hasn't generated yet, an 8-second fallback is used per missing entry.

Examples:

| Configuration | Estimated Output | Credits |
|---|---|---|
| 2 clips × 5s, cut transition | 10s | 2 |
| 3 clips × 10s, fade 0.5s | 29s | 7 (6 base + 1 input adder) |
| 5 clips × 8s, dissolve 0.5s, trim 24+24 frames per clip | 28s | 9 (6 base + 3 input adder) |

The Run button shows the live estimate.

## Best Practices

- Use "fade" (0.5s) for professional-looking transitions between most clips
- Use "cut" for fast-paced edits or when clips are meant to be seamless
- Reorder clips via drag-and-drop before running the workflow
- Keep transition duration short (0.3-0.5s) for social media content
- Use **Trim End Frames** to drop VEO 3.1 tail dissolves consistently across all clips before concat

## Common Use Cases

- Assemble AI-generated video clips into a sequence
- Join multiple Image-to-Video outputs into a longer video
- Create montages from different generation nodes
- Build final videos from individually processed clips
- Build perfect-loop sequences (combine an i2v clip with itself to create a loop, paired with merge-video-audio for soundtrack)

## Tips

- "Dip-to-black" works well between scenes with different settings or moods
- Audio crossfade prevents jarring audio cuts during transitions — 0.5–1s blends ambient soundtracks smoothly across a hard cut without touching the picture
- Connect a Merge Video & Audio node after combining to add a soundtrack
- Per-clip frame trim is applied uniformly to every connected input — useful when all upstream clips have the same fixed-length tail dissolve
