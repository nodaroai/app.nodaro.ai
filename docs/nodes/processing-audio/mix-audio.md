# Mix Audio

> Blend multiple audio tracks with individual volume control.

## Overview

The Mix Audio node layers multiple audio tracks together with per-track volume control. Reorder tracks via drag-and-drop and adjust each track's volume from 0% to 200%. The output is a single mixed audio file.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Track Ordering | Drag list | — | Reorder connected audio tracks |
| Per-Track Volume | Slider | 100% | Volume for each track: 0-200% |

Auto-detects connected audio nodes and displays them in the track list.

## Inputs & Outputs

**Inputs:** 2+ audio tracks (connected via input handles)
**Outputs:** Single mixed audio file

## Credit Cost

0 credits — FFmpeg processing, always free.

## Best Practices

- Keep voiceover at 100% and reduce background music to 30-50% for clear speech
- Use volume above 100% sparingly — it can introduce clipping/distortion
- Layer tracks intentionally: voice first, then music, then effects
- Preview the mix before connecting to downstream nodes

## Common Use Cases

- Layer voiceover on top of background music
- Combine multiple sound effects with a music track
- Mix dialogue with ambient audio for cinematic scenes
- Create audio beds from multiple generated audio tracks

## Tips

- Connect to Merge Video & Audio after mixing to add the combined audio to video
- For simple volume adjustment of a single track, use Adjust Volume instead
