# Generate Music
> Create original music tracks from text prompts using Suno AI models.

## Overview

The Generate Music node produces original music from a text description using Suno's music generation models. It supports two model versions with different quality and cost tiers. This is the basic music generation node -- for advanced Suno features like covers, extensions, lyrics generation, stem separation, and more, use the dedicated Suno-specific nodes.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Prompt | `string` | `""` | Description of the desired music (max 3000 characters). Describe genre, mood, tempo, instruments, and style |
| Duration | `number` | `8` | Target duration in seconds |
| Provider | `MusicProvider` | `"suno"` | Music generation model (see Providers table below) |
| Genre | `string` | `""` | Optional genre hint (e.g., "electronic", "jazz", "cinematic") |
| Mood | `string` | `""` | Optional mood descriptor (e.g., "uplifting", "dark", "relaxing") |
| Instrumental | `boolean` | `true` | Generate instrumental-only track (no vocals) |
| Lyrics | `string` | `""` | Optional lyrics for vocal tracks (ignored when Instrumental is true) |
| Reference Source | `"none" \| "upload" \| "youtube"` | `"none"` | Optional reference audio source for style guidance |
| Reference Audio URL | `string` | `""` | URL of uploaded reference audio (when Reference Source is "upload") |
| Reference YouTube URL | `string` | `""` | YouTube URL for style reference (when Reference Source is "youtube") |

### Providers

| Provider | Model | Notes |
|----------|-------|-------|
| `suno` | Suno V4 | Standard quality, lower cost |
| `suno-v5` | Suno V5 | Premium quality, higher fidelity |

## Inputs & Outputs

- **Input**: `in` -- optional upstream text connection for dynamic prompt via field mapping
- **Output**: `audio` -- generated music track (URL)
## Best Practices

- Write detailed prompts that specify genre, instruments, tempo, mood, and structure. "Upbeat electronic dance track, 120 BPM, synth leads, punchy drums, building energy" works better than "dance music."
- Use Suno V5 for final production tracks and V4 for rapid iteration and exploration.
- Keep Instrumental enabled unless you specifically need generated vocals. Instrumental tracks are generally more versatile for video backgrounds and compositions.
- When providing lyrics, structure them with line breaks. The model interprets line breaks as phrasing cues.
- Use reference audio sparingly -- it guides style but can sometimes constrain creativity.

## Common Use Cases

- Creating background music for video projects
- Generating custom soundtracks matched to specific moods or scenes
- Producing jingles or short musical stings
- Composing instrumental beds for podcasts or voiceover content
- Prototyping music ideas before working with a composer

## Tips

- For advanced Suno features (covers, extensions, style boost, stem separation, mashups), use the dedicated Suno nodes: Suno Generate, Suno Cover, Suno Extend, Suno Lyrics, Suno Separate, Suno Music Video, and Suno Upload Extend.
- The prompt maximum is 3000 characters, providing room for very detailed descriptions including specific instruments, arrangement notes, and dynamic changes.
- Reference audio can help steer the style, but the output will never be a copy of the reference. It influences mood and instrumentation rather than melody.
- Generated music tracks can be connected to Merge Video & Audio for adding background music to video, or to Mix Audio for layering with other audio sources.
- The `modelVersion` field in the node data controls which Suno model version is used.
