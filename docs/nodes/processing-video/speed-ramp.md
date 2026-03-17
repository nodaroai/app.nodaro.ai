# Adjust Speed

> Change video playback speed with audio adjustment.

## Overview

The Adjust Speed (Speed Ramp) node changes video playback speed from 0.25x (slow motion) to 4x (fast forward). Optionally adjusts audio pitch to match the new speed, or removes audio entirely.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Speed | Slider | 1.0 | Playback speed: 0.25x to 4.0x (5% increments) |
| Adjust Audio Speed | Boolean | true | Match audio pitch to speed; false removes audio |

## Inputs & Outputs

**Inputs:** Video (required)
**Outputs:** Speed-adjusted video
## Best Practices

- Use 0.5x for smooth slow motion of action scenes
- Use 2x-4x for time-lapse or montage effects
- Disable audio speed adjustment if the pitch change sounds unnatural
- Original frame rate affects slow-motion quality — higher FPS sources look smoother at low speeds

## Common Use Cases

- Create slow-motion highlights from action footage
- Speed up process or tutorial videos
- Build time-lapse sequences from real-time footage
- Adjust pacing of AI-generated video clips

## Tips

- Below 0.5x, video may appear choppy unless the source has high frame rate
- When audio adjustment is off, the audio track is removed entirely (not muted)
- Chain with Trim Video to speed-adjust only a specific section
