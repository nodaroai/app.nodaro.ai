# Text to Speech
> Convert text into natural-sounding speech using ElevenLabs voice models with support for audio tags, multiple languages, and custom voices.

## Overview

The Text to Speech node generates spoken audio from text input using ElevenLabs models. It supports three provider tiers with varying language coverage and feature sets. The recommended provider, ElevenLabs v3, supports inline audio tags for emotions, reactions, and sound effects, while v2 models automatically strip these tags before processing.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Text Source | `"connected" \| "direct"` | `"connected"` | Whether text comes from an upstream node or is entered directly in the config panel |
| Direct Text | `string` | `""` | Text to speak when Text Source is "direct" |
| Provider | `TtsProvider` | `"elevenlabs-v3"` | Voice synthesis engine (see Providers table below) |
| Voice | `string` | `"Rachel"` | Voice selection -- premade, custom (cloned), or library voice via VoiceBrowser |
| Voice Type | `"premade" \| "custom" \| "library"` | `"premade"` | Source of the selected voice |
| Language | `string` | `"en"` | Target language code, or empty for auto-detect. Available languages depend on provider model (see Language Support below) |
| Stability | `number` (0-1) | voice's own | Controls voice consistency. Lower values produce more expressive but variable speech |
| Similarity Boost | `number` (0-1) | voice's own | How closely output matches the target voice timbre. v2 models only |
| Style Exaggeration | `number` (0-1) | voice's own | Amplifies the style of the original voice. v2 models only |
| Speed | `number` (0.7-1.2) | voice's own | Playback speed multiplier. v2 models only |

### Voice settings & preview fidelity

When you don't touch the sliders, generation uses the **voice's own stored settings** (including speaker boost) — the same settings its preview was rendered with, so output matches what you heard in the Voice Browser. When you adjust one or more sliders, your values are merged **over** the voice's stored settings rather than resetting the others to generic defaults.

Voice Library voices are verified per model by their creators. The Voice Browser knows each library voice's verified models: selecting a library voice while the node is set to a v2 model the voice is **not** verified for automatically snaps the provider to a verified one (your explicit choice is kept whenever the voice is verified for it; the default v3 renders any voice and is never changed).

### Voice errors

If the selected voice no longer exists on ElevenLabs (e.g. it was removed from the Voice Library or the clone was deleted), the job **fails with a clear error** instead of silently substituting a different voice. The only exception is LLM-originated requests through the MCP `generate_speech` tool, where a hallucinated voice id falls back to the default voice (Rachel) so the agent still gets audio back.

### Providers

| Provider | Model | Languages | Audio Tags |
|----------|-------|-----------|------------|
| `elevenlabs-v3` | ElevenLabs v3 (recommended) | 46 | Yes |
| `elevenlabs-turbo` | Turbo v2.5 | 32 | No (stripped) |
| `elevenlabs-multilingual` | Multilingual v2 | 29 | No (stripped) |

### Language Support

- **Multilingual v2 (29)**: English, Japanese, Chinese, German, Hindi, French, Korean, Portuguese, Italian, Spanish, Indonesian, Dutch, Turkish, Filipino, Polish, Swedish, Bulgarian, Romanian, Arabic, Czech, Greek, Finnish, Croatian, Malay, Slovak, Danish, Tamil, Ukrainian, Russian
- **Turbo v2.5 (32)**: All Multilingual v2 languages plus Hungarian, Norwegian, Vietnamese
- **v3 (46)**: All Turbo v2.5 languages plus Hebrew, Thai, Bengali, Urdu, Persian, Serbian, Lithuanian, Latvian, Estonian, Georgian, Icelandic, Catalan, Afrikaans, Swahili

## Inputs & Outputs

- **Input**: `in` -- text string (from Text Prompt, Generate Text, Combine Text, or any text-producing node)
- **Output**: `audio` -- generated speech audio file (URL)
## Best Practices

- Use ElevenLabs v3 for the widest language support and audio tag capabilities.
- Keep Stability around 0.5 for a balance between expressiveness and consistency. Push toward 1.0 for narration that needs to sound uniform.
- When using audio tags with v3, place them inline in the text at the point where the effect should occur (e.g., `"I can't believe it [laughs] that's amazing"`).
- For custom voices, clone a voice first using the Voice Clone node, then select it here via the "My Voices" tab in the Voice Browser.
- Avoid mixing audio tags into text that will be sent to v2 models -- the tags are stripped automatically, but the resulting text may read awkwardly.

## Common Use Cases

- Generating voiceover narration for video projects
- Creating character dialogue for animations or explainer videos
- Producing podcast-style audio from written scripts
- Adding multilingual voiceovers for localized content
- Creating expressive speech with embedded emotions and sound effects (v3)

## Tips

- The Voice Browser dialog provides search, filtering by gender/accent/age/language, and audio previews to help select the right premade voice.
- Audio tags supported by v3 include emotions (`[excited]`, `[sad]`, `[angry]`), reactions (`[laughs]`, `[sighs]`, `[gasps]`), delivery styles (`[whispers]`, `[shouting]`), pacing (`[pause]`, `[long pause]`), tone (`[cheerfully]`, `[deadpan]`), and sound effects (`[applause]`, `[thunder]`).
- v2 models support SSML break tags (e.g., `<break time="1.0s" />`) for inserting pauses.
- Setting Language to auto-detect works well for most cases, but explicitly selecting a language can improve pronunciation accuracy for non-English text.
- Custom cloned voices always route through the direct ElevenLabs API.
