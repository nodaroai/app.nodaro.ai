# Suno Separate
> Separate vocals from instrumentals, or split a track into individual stems.

## Overview

Suno Separate offers two modes of audio separation. Vocal separation isolates vocals and instrumentals into two tracks. Full stem splitting decomposes a track into up to 12 individual stems (drums, bass, guitar, piano, etc.). The node requires a Suno Task ID and Audio ID from an upstream Suno node.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Separation Type | enum | `"separate_vocal"` | `"separate_vocal"` for vocal/instrumental split, `"split_stem"` for full 12-stem separation. |
| Task ID | string | `""` | Suno task ID from an upstream Suno node (required). |
| Audio ID | string | `""` | Suno audio ID from an upstream Suno node (required). |

## Inputs & Outputs

- **Inputs:** `audio` -- Suno task ID and audio ID from an upstream Suno node
- **Outputs:** `audio` -- separated audio URL(s)

### Output Details

**Vocal Separation (`separate_vocal`):**
- `vocalUrl` -- isolated vocal track
- `instrumentalUrl` -- isolated instrumental track

**Full Stem Split (`split_stem`):**
- `stems` -- object containing up to 12 individual stem URLs (drums, bass, guitar, piano, vocals, etc.)

## Credit Cost

- **Vocal separation (`separate_vocal`):** 5 credits
- **Full stem split (`split_stem`):** 16 credits

## Best Practices

- Start with vocal separation at 5 credits before committing to a full stem split at 16 credits.
- Use vocal separation when you only need to isolate vocals for dubbing, voice changing, or remixing.
- Use full stem splitting when you need granular control over individual instruments for mixing or re-arrangement.
- Connect the vocal output to a Voice Changer or Dubbing node for further processing.
- Connect the instrumental output to Suno Add Vocals to layer new vocals onto the backing track.

## Common Use Cases

- Extracting vocals from a song for remixing or sampling.
- Isolating instrumentals for karaoke or background music.
- Decomposing a full mix into stems for re-mixing or mastering.
- Preparing isolated vocal tracks for voice changing or dubbing workflows.
- Creating acapella versions of generated songs.

## Tips

- Both Task ID and Audio ID are required -- these come from upstream Suno nodes, not from raw audio files.
- For non-Suno audio files, consider using the Audio Isolation node (ElevenLabs Voice Extractor) instead.
- The 12-stem split costs over three times as much as vocal separation -- only use it when you need individual instrument control.
- Stem names in the output depend on what the AI detects in the source audio.
