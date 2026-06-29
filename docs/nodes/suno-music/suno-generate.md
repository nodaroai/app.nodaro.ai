# Suno Generate
> Full song generation using Suno AI with extensive creative controls.

## Overview

Suno Generate creates complete songs from text prompts. It supports multiple Suno model versions, custom lyrics with metatag formatting, genre/style tags, and fine-grained controls for vocal gender, style weight, weirdness, and audio weight. The prompt field supports Suno metatag autocomplete for structured lyrics.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Prompt | string | `""` | Main text prompt describing the song (in custom mode, the lyrics). Supports Suno metatag autocomplete. Max length is per-version: **5000** for V4.5 / V4.5PLUS / V4.5ALL / V5 / V5.5, **3000** for V4; **500** in non-custom (inspiration) mode. Over-long input is truncated to the model's limit — the editor warns first so you can switch model or shorten. |
| Model | enum | `"V5"` | Suno model version: `V5`, `V4_5ALL`, `V4_5PLUS`, `V4_5`, `V4`. |
| Title | string (max 80) | `""` | Title for the generated song (Suno caps titles at 80 characters). |
| Lyrics | string | `""` | Song lyrics with metatag support (`[Verse]`, `[Chorus]`, `[Bridge]`, etc.). Same per-version max as Prompt (5000 for V4.5+/V5, 3000 for V4). |
| Style | string (max 1000) | `""` | Genre and style tags (e.g., "pop rock, upbeat, energetic"). Max **1000** for V4.5+/V5, **200** for V4. |
| Negative Style | string (max 500) | `""` | Styles to avoid in generation. |
| Vocal Gender | enum | auto | `"male"`, `"female"`, or unset for automatic selection. |
| Style Weight | number | `0.5` | Influence of style tags on output (0.0 to 1.0). |
| Weirdness | number | `0.0` | Controls experimental/unconventional output (0.0 to 1.0). |
| Audio Weight | number | `0.5` | Balance between prompt and audio characteristics (0.0 to 1.0). |
| Custom Mode | boolean | `false` | Enables advanced parameter control. |
| Instrumental | boolean | `false` | When true, generates instrumental-only (no vocals). |

## Inputs & Outputs

**Inputs**

| Handle | Accepts | Routes to |
|--------|---------|-----------|
| Prompt | text producers + audio/visual pickers | `prompt` |
| Audio style | audio pickers (genre/mood/instrumentation), voice describers | folded into `style`/`prompt` |
| Voice | voice persona (suno-voice / voice-design / voice-character) | `personaId` |
| Style *(Advanced)* | text producers | `style` |
| Lyrics *(Advanced)* | text producers | `lyrics` |
| Title *(Advanced)* | text producers | `title` |
| Negative style *(Advanced)* | text producers | `negativeStyle` |

The four **Advanced** handles appear when you expand **Advanced ▾** on the node (or when the field already has content/a wire). Wiring any of Style / Lyrics / Title puts Suno into **custom mode** automatically.

**Outputs**

- `audio` — generated audio URL

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
