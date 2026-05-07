# Combine Videos

> Concatenate multiple video clips with transitions and per-clip frame trim.

## Overview

The Combine Videos node joins multiple video clips in sequence with configurable transitions between them. Supports drag-and-drop reordering of connected clips and per-clip head/tail frame trimming. All processing is done via FFmpeg.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Transition | Select | fade | Transition type between clips |
| Transition Duration | Number | 0.5 | Duration in seconds (0.1-2s), hidden for "cut" |
| Audio Mode | Select | crossfade | How to handle audio during transitions |
| Trim Start Frames | Number | 0 | Frames trimmed from the start of EACH clip (0-120) |
| Trim End Frames | Number | 0 | Frames trimmed from the end of EACH clip (0-120) |
| Clip Ordering | Drag list | — | Reorder connected video clips |

### Transition Options

| Transition | Description |
|------------|-------------|
| cut | Hard cut, no transition effect |
| fade | Cross-fade between clips |
| dissolve | Dissolve blend transition |
| dip-to-black | Fade to black, then fade in |
| dip-to-white | Fade to white, then fade in |

### Audio Modes

- **keep** — Preserve original audio from each clip
- **crossfade** — Blend audio during transition
- **remove** — Strip all audio from output

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
- Audio crossfade prevents jarring audio cuts during transitions
- Connect a Merge Video & Audio node after combining to add a soundtrack
- Per-clip frame trim is applied uniformly to every connected input — useful when all upstream clips have the same fixed-length tail dissolve
