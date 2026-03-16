# Combine Videos

> Concatenate multiple video clips with transitions.

## Overview

The Combine Videos node joins multiple video clips in sequence with configurable transitions between them. Supports drag-and-drop reordering of connected clips. All processing is done via FFmpeg — no AI credits consumed.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Transition | Select | fade | Transition type between clips |
| Transition Duration | Number | 0.5 | Duration in seconds (0.1-2s), hidden for "cut" |
| Audio Mode | Select | keep | How to handle audio during transitions |
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

0 credits — FFmpeg processing, always free.

## Best Practices

- Use "fade" (0.5s) for professional-looking transitions between most clips
- Use "cut" for fast-paced edits or when clips are meant to be seamless
- Reorder clips via drag-and-drop before running the workflow
- Keep transition duration short (0.3-0.5s) for social media content

## Common Use Cases

- Assemble AI-generated video clips into a sequence
- Join multiple Image-to-Video outputs into a longer video
- Create montages from different generation nodes
- Build final videos from individually processed clips

## Tips

- "Dip-to-black" works well between scenes with different settings or moods
- Audio crossfade prevents jarring audio cuts during transitions
- Connect a Merge Video & Audio node after combining to add a soundtrack
