# Mix Audio

> Blend multiple audio tracks with individual volume control.

## Overview

The Mix Audio node layers multiple audio tracks together with per-track volume control. Reorder tracks via drag-and-drop and adjust each track's volume from 0% to 200%. The output is a single mixed audio file.

With **Duck under** set, one track (usually the voice) pulls every other track down while it is loud and lets them back up in its pauses, so a music bed sits under speech without you riding the volume by hand.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Track Ordering | Drag list | — | Reorder connected audio tracks |
| Per-Track Volume | Slider | 100% | Volume for each track: 0-200% |
| Duck under (`duckUnder`) | Track picker | Off | The track the others dip under. Shown once two or more tracks are connected. Off is a plain mix. |
| Duck amount (`duckAmount`) | Slider | 75% | How hard the other tracks dip, 0-100. Shown while a duck track is set. |

Auto-detects connected audio nodes and displays them in the track list.

## Ducking

Ducking is sidechain compression: the loudness of the **Duck under** track drives a compressor on every other track. The other tracks are pulled down while that track is above the threshold and return after it falls quiet.

**Duck amount** is the share of the voice's excess over the threshold that is taken off the other tracks, so the dip grows in step with the slider:

| Duck amount | Compressor ratio |
|-------------|------------------|
| 0 | 1 (no dip) |
| 50 | 2 |
| 75 (default) | 4 |
| 90 | 10 |
| 95-100 | 20 (the most the compressor allows) |

The ratio is `1 / (1 − amount/100)`, capped at 20.

The fine controls are available through the API, SDK, CLI and MCP (`mix_audio`); the node uses their defaults:

| Control | Default | Range |
|---------|---------|-------|
| `thresholdDb` | -30 dBFS | -60 to 0 |
| `attackMs` | 20 | 1 to 2000 |
| `releaseMs` | 500 | 10 to 9000 |
| `ratio` | from `amount` | 1 to 20 (overrides `amount` when given) |

A ducked mix **sums** its tracks instead of averaging them, so the voice keeps its own level (a plain mix divides every track by the number of tracks). A limiter keeps the sum from clipping. If the key track ends before the others, the others return to full level and play to their own end. A plain mix, with no duck, is unchanged.

If the track you picked is later disconnected, the node falls back to a plain mix.

## Inputs & Outputs

**Inputs:** 2+ audio tracks (connected via input handles)
**Outputs:** `audio-out` — single mixed audio file

## Credits

**Flat 20 credits per run**, with or without a duck.

## Worked example

A narration and a music bed, with **Duck under** set to the narration and the default **Duck amount** of 75:

1. 75 maps to a compressor ratio of `1 / (1 − 0.75) = 4`.
2. The narration is above the -30 dBFS threshold, so within about 20 ms the music starts to dip, by roughly three quarters of how far the narration sits over that threshold.
3. When the narration pauses, the music rises back to its own level over about 500 ms.
4. If the narration file is shorter than the music, the music is not cut off with it: it returns to full level and plays to the end.

## Best Practices

- Keep voiceover at 100% and reduce background music to 30-50% for clear speech, or set **Duck under** to the voiceover so the music dips only while it speaks
- Pick the voice as the **Duck under** track, not the music, and raise **Duck amount** if the bed still competes with speech
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
