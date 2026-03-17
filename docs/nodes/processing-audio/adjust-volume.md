# Adjust Volume

> Change audio volume and add fade transitions.

## Overview

The Adjust Volume node modifies the volume level of an audio track and optionally adds fade-in and fade-out transitions. Includes a normalize option to automatically level audio to a standard volume.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Volume | Slider | 100% | Output volume: 0-200% |
| Normalize | Boolean | false | Auto-level to standard volume |
| Fade In | Number | 0 | Fade-in duration: 0-10 seconds |
| Fade Out | Number | 0 | Fade-out duration: 0-10 seconds |

## Inputs & Outputs

**Inputs:** Audio (required)
**Outputs:** Volume-adjusted audio
## Best Practices

- Use normalize for audio from different sources to ensure consistent levels
- Keep volume at or below 100% to avoid clipping
- Add short fades (0.5-1s) for smooth audio starts and ends
- Use before Mix Audio to balance tracks at the source level

## Common Use Cases

- Normalize TTS output for consistent volume across clips
- Add fade-in/out to music tracks for smooth transitions
- Reduce volume of background audio before mixing
- Boost quiet audio from recorded sources

## Tips

- Normalize overrides the volume setting — if enabled, volume slider is ignored
- Fades are applied after volume adjustment
- For per-track mixing of multiple sources, use Mix Audio instead
