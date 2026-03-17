# Loop Video

> Repeat video to reach a target duration or count.

## Overview

The Loop Video node extends short video clips by repeating them. Choose between repeating a fixed number of times or looping until a target duration is reached. Useful for extending short AI-generated clips for use as backgrounds or B-roll.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Mode | Select | repeat | repeat (N times) or duration (loop to target) |
| Repeat Count | Number | 2 | Number of repetitions: 2-20x (repeat mode) |
| Target Duration | Number | — | Target length in seconds: 1-300s (duration mode) |

## Inputs & Outputs

**Inputs:** Video (required)
**Outputs:** Looped video
## Best Practices

- Use "duration" mode when you need a specific length (e.g., 30s for social media)
- Ensure loop points are seamless — clips that start and end similarly loop better
- Use with Fade In/Out to smooth loop transitions

## Common Use Cases

- Extend a 5-second AI-generated clip to 30 seconds for Instagram
- Create repeating background videos for presentations
- Loop ambient or atmospheric footage for extended scenes

## Tips

- Duration mode trims the final loop to exactly the target length
- For truly seamless loops, generate source video with matching start and end frames
