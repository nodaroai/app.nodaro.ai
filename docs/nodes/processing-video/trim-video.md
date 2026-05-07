# Trim Video

> Cut video by time, frame count, or by smart-loop-cut to find the cleanest loop boundary.

## Overview

The Trim Video node extracts or shapes a section of video. Three modes:

- **Time** — classic start/end seconds
- **Frames** — frame-precise trim from start and/or end (worker probes the source's fps)
- **Smart Loop Cut** — picks the trailing frame closest to frame 0 by PSNR pixel similarity and trims there (best for VEO 3.1 first+last-frame outputs whose tail dissolve isn't always exactly 8 frames in)

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Trim Mode | Select | time | time / frames / smart-loop-cut |
| Start Time (s) | Number | 0 | Start position in seconds (time mode) |
| End Time (s) | Number | — | End position in seconds (time mode) |
| Trim Start Frames | Number | 0 | Frames trimmed from the start (frames mode) |
| Trim End Frames | Number | 0 | Frames trimmed from the end (frames mode) |
| Lookback Window (frames) | Number | 16 | Trailing-frame search window (2-64), smart-loop-cut mode |
| Output Silent Video | Checkbox | off | Strip audio from the trimmed clip — single output is silent |

## Inputs & Outputs

**Inputs:** Video (required)
**Outputs:** Single trimmed video clip — silent when "Output Silent Video" is enabled, otherwise audio is preserved.

## Credit Cost

Trim Video is **dynamically priced** based on output length:

- **Time mode:** 1 credit per 5 seconds of `(endTime - startTime)`, minimum 1
- **Frames mode:** 1 credit per 5 seconds of remaining duration (assumes 24fps for estimation)
- **Smart loop cut:** 1 credit per 5 seconds of upstream length + 1 credit per ~24 frames of lookback

Examples:

| Configuration | Output | Credits |
|---|---|---|
| Time mode, 0–10s | 10s | 2 |
| Frames mode on a 10s clip, trim 24+24 frames | ~8s | 2 |
| Smart loop cut on a 10s clip, lookback 16 | ≤10s | 3 |

The Run button shows the live estimate. When the upstream isn't generated yet, an 8-second fallback is used.

## Best Practices

- Preview the source video first to identify exact trim points
- Use **Frames mode** when frame alignment matters (e.g., 24fps VEO outputs and you want to drop the last 8 frames precisely)
- Use **Smart Loop Cut** for stochastic tails — beats a fixed offset on outputs whose ideal cut isn't deterministic
- Leave Start Time at 0 if you only need to shorten the end
- Use before Combine Videos to select the best segments from multiple clips

## Common Use Cases

- Extract a specific scene from a longer video
- Remove unwanted intro/outro from generated video
- Cut AI-generated video to exact duration needed
- Drop the VEO tail dissolve precisely (frames or smart-cut)
- Prepare clips for combination or composition

## Tips

- Time mode supports decimal precision (e.g., 2.5 for 2.5 seconds)
- Frame mode requires the worker to probe the source fps — it will hard-error rather than silently mis-convert if probing fails
- Smart loop cut returns metadata (chosen frame index, PSNR) in the job result, useful for debugging seam quality
- If you only need audio from the video, use Trim Audio instead
