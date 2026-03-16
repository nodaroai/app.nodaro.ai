# Fade In/Out

> Add fade transitions to the beginning and end of video.

## Overview

The Fade In/Out node adds smooth fade transitions to video. Configure fade-in, fade-out, or both, with black or white fade color. Each fade is independently toggleable with its own duration.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Fade Color | Select | black | Fade to/from: black or white |
| Fade In | Boolean | true | Enable fade-in at start |
| Fade In Duration | Number | 0.5 | Fade-in length: 0.1-3.0 seconds |
| Fade Out | Boolean | true | Enable fade-out at end |
| Fade Out Duration | Number | 0.5 | Fade-out length: 0.1-3.0 seconds |

## Inputs & Outputs

**Inputs:** Video (required)
**Outputs:** Video with fade transitions

## Credit Cost

0 credits — FFmpeg processing, always free.

## Best Practices

- 0.5s is a good default for most content
- Use longer fades (1-2s) for cinematic or dramatic content
- Black fades are standard for most video; white fades work well for bright, upbeat content
- Apply after all other processing to avoid fades being cut by downstream trim/combine

## Common Use Cases

- Add professional intro/outro transitions to any video
- Smooth the beginning of AI-generated clips that start abruptly
- Create dreamy or dramatic transitions between scenes

## Tips

- Fade In/Out only affects the start and end — for transitions between clips, use Combine Videos with transitions
- Fade-in and fade-out can have different durations for asymmetric timing
