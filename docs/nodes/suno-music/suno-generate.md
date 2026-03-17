# Suno Generate
> Full song generation using Suno AI with extensive creative controls.

## Overview

Suno Generate creates complete songs from text prompts. It supports multiple Suno model versions, custom lyrics with metatag formatting, genre/style tags, and fine-grained controls for vocal gender, style weight, weirdness, and audio weight. The prompt field supports Suno metatag autocomplete for structured lyrics.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Prompt | string (max 3000) | `""` | Main text prompt describing the song. Supports Suno metatag autocomplete. |
| Model | enum | `"V5"` | Suno model version: `V5`, `V4_5ALL`, `V4_5PLUS`, `V4_5`, `V4`. |
| Title | string (max 200) | `""` | Title for the generated song. |
| Lyrics | string (max 3000) | `""` | Song lyrics with metatag support (`[Verse]`, `[Chorus]`, `[Bridge]`, etc.). |
| Style | string (max 500) | `""` | Genre and style tags (e.g., "pop rock, upbeat, energetic"). |
| Negative Style | string (max 500) | `""` | Styles to avoid in generation. |
| Vocal Gender | enum | auto | `"male"`, `"female"`, or unset for automatic selection. |
| Style Weight | number | `0.5` | Influence of style tags on output (0.0 to 1.0). |
| Weirdness | number | `0.0` | Controls experimental/unconventional output (0.0 to 1.0). |
| Audio Weight | number | `0.5` | Balance between prompt and audio characteristics (0.0 to 1.0). |
| Custom Mode | boolean | `false` | Enables advanced parameter control. |
| Instrumental | boolean | `false` | When true, generates instrumental-only (no vocals). |

## Inputs & Outputs

- **Inputs:** `in` -- optional upstream connection (text prompt, etc.)
- **Outputs:** `audio` -- generated audio URL
## Best Practices

- Use Suno metatags in lyrics (`[Verse]`, `[Chorus]`, `[Bridge]`, `[Outro]`) to structure the song.
- Keep Style Weight around 0.5 for balanced results; push toward 1.0 only when you need strict genre adherence.
- Set Weirdness to 0.0 for predictable output; increase gradually for more experimental results.
- Use Negative Style to explicitly exclude unwanted genres (e.g., "metal, screaming") rather than relying on the prompt alone.
- V5 produces higher quality output than V4 models.

## Common Use Cases

- Generating a complete song from a text description and lyrics.
- Creating instrumental background music for video content.
- Producing genre-specific tracks (pop, rock, jazz, electronic) using style tags.
- Rapid prototyping of song ideas before professional production.
- Generating multiple variations of a concept by adjusting style weight and weirdness.

## Tips

- Combine structured lyrics (with metatags) and a descriptive prompt for the most coherent results.
- The Instrumental toggle is useful for creating backing tracks that can later receive vocals via Suno Add Vocals.
- When using Custom Mode, all advanced parameters (style weight, weirdness, audio weight) become active.
- Connect a Suno Lyrics node upstream to auto-generate lyrics before song creation.
