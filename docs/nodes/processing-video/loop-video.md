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
**Outputs:** `video-out` — looped video

## Credit Cost

Loop Video is **dynamically priced** based on output length and smart-cut work:

- **Base:** 11 credits<!-- credits-rate: loop-video --> per started 5 seconds of output (minimum 11 credits<!-- credits: loop-video -->)
- **Smart cut adder:** +11 credits<!-- credits-rate: loop-video --> per started 24 frames of lookback (when smart cut is enabled)

The base and the adder are priced together as one charge.

A single-node run, a run inside a workflow, and MCP or SDK calls are all charged this way, and the workflow's estimate before a run quotes the same price.

Examples:

| Configuration | Output | Credits |
|---|---|---|
| Repeat 4× a 5s clip | 20s | 44<!-- credits: loop-video@4 --> |
| Repeat 3× a 10s clip | 30s | 66<!-- credits: loop-video@6 --> |
| Loop to 60s | 60s | 132<!-- credits: loop-video@12 --> |
| Loop to 30s + smart cut, lookback 16 | 30s | 77<!-- credits: loop-video@7 --> (66<!-- credits-rate: loop-video@6 --> base + 11<!-- credits-rate: loop-video --> cut) |
| Loop to 60s + smart cut, lookback 64 | 60s | 165<!-- credits: loop-video@15 --> (132<!-- credits-rate: loop-video@12 --> base + 33<!-- credits-rate: loop-video@3 --> cut) |

The Run button on the node displays the live credit estimate. When the upstream node hasn't generated yet, an 8-second fallback duration is used for the estimate.

**The upstream length a run is charged by** (in the editor, in a workflow run, and in a published app) is the length of the video the wire hands on:

- an uploaded clip: the length measured when it was uploaded, as long as that upload is still the node's file. A link pasted into Upload Video later is charged at the fallback below, never at an earlier upload's length;
- the output of a Trim, Loop or Combine Videos: the length that step passes on (a Trim's window, a Loop's copies or target, a Combine's clips added up), the same length the estimate before the run uses;
- a render's output (Apply EDL): the length of the cut it rendered. The estimate before the run prices it at the render's length rounded up to whole minutes, so the run never costs more than its estimate;
- a list of clips on one wire (a Bundle, such as UGC Finish's finished clips): each clip at its own length;
- anything else: the length the source recorded, else its configured duration.

When none of these is known, the run is charged at an 8-second fallback per clip.

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
