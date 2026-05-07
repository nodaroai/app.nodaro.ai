# Loop Video

> Repeat video to reach a target duration or count, with optional smart-loop-cut for seamless seams.

## Overview

The Loop Video node extends short video clips by repeating them. Choose between repeating a fixed number of times or looping until a target duration is reached. An optional **Smart Loop Cut** preprocess trims the source clip to its cleanest loop boundary BEFORE concatenating, eliminating seam discontinuity at every internal repeat — useful for VEO 3.1 outputs and any clip with a stochastic tail.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Mode | Select | repeat | repeat (N times) or duration (loop to target) |
| Repeat Count | Number | 2 | Number of repetitions: 2-20x (repeat mode) |
| Target Duration | Number | — | Target length in seconds: 1-300s (duration mode) |
| Smart Cut Before Looping | Checkbox | off | Trim input to the cleanest loop boundary before concat |
| Lookback Window (frames) | Number | 16 | How many trailing frames to evaluate (2-64) when smart cut is on |

## Inputs & Outputs

**Inputs:** Video (required)
**Outputs:** Looped video

## Credit Cost

Loop Video is **dynamically priced** based on output length and smart-cut work:

- **Base:** 1 credit per 5 seconds of output (ceiling, minimum 1 credit)
- **Smart cut adder:** +1 credit per ~24 frames of lookback (when smart cut is enabled)

Examples:

| Configuration | Output | Credits |
|---|---|---|
| Repeat 4× a 5s clip | 20s | 4 |
| Loop to 60s | 60s | 12 |
| Loop to 30s + smart cut, lookback 16 | 30s | 7 (6 base + 1 cut) |
| Loop to 60s + smart cut, lookback 64 | 60s | 15 (12 base + 3 cut) |

The Run button on the node displays the live credit estimate. When the upstream node hasn't generated yet, an 8-second fallback duration is used for the estimate.

## Best Practices

- Use "duration" mode when you need a specific length (e.g., 30s for social media)
- Enable **Smart Loop Cut** for VEO 3.1 outputs and any clip with a stochastic tail dissolve — it picks the trailing frame closest to frame 0 (by PSNR pixel similarity) and trims there, beating a fixed offset on stochastic outputs
- Ensure loop points are seamless — clips that start and end similarly loop better
- Use with Fade In/Out to smooth loop transitions

## Common Use Cases

- Extend a 5-second AI-generated clip to 30 seconds for Instagram
- Create repeating background videos for presentations
- Loop ambient or atmospheric footage for extended scenes
- Build seamless perfect-loops from VEO 3.1 first+last-frame outputs (with smart cut on)

## Tips

- Duration mode trims the final loop to exactly the target length
- For truly seamless loops, generate source video with matching start and end frames AND enable smart cut
- Smart cut runs a single ffmpeg pass + per-candidate PSNR comparison — adds ~1-3s of work depending on lookback
