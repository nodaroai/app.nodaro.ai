# Suno Cover
> Create a cover version of an existing audio track using Suno AI.

## Overview

Suno Cover takes a source audio track and generates a new cover version of it. You can customize the output with different lyrics, style tags, vocal gender, and model selection. The source audio can be provided via a direct URL or connected from an upstream node.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Prompt | string | `""` | Description of how the cover should differ from the original. Max length is per-version: **5000** for V4.5 / V4.5PLUS / V4.5ALL / V5 / V5.5, **3000** for V4; **3000** in non-custom mode. Over-long input is truncated to the model's limit — the editor warns first. |
| Source Audio URL | URL | `""` | URL of the source audio to cover. Can be connected from an upstream node. |
| Model | enum | `"V5"` | Suno model version: `V5`, `V4_5ALL`, `V4_5PLUS`, `V4_5`, `V4`. |
| Title | string (max 80) | `""` | Title for the cover version. |
| Lyrics | string | `""` | Custom lyrics for the cover. Supports Suno metatags. Same per-version max as Prompt. |
| Style | string (max 1000) | `""` | Genre and style tags for the cover. Max **1000** for V4.5+/V5, **200** for V4. |
| Negative Style | string (max 500) | `""` | Styles to avoid in the cover. |
| Vocal Gender | enum | auto | `"male"`, `"female"`, or unset for automatic selection. |
| Custom Mode | boolean | `false` | Enables advanced parameter control. |
| Instrumental | boolean | `false` | When true, generates an instrumental cover (removes vocals). |
| `promptPrefix` / `promptSuffix` | text | -- | Optional pre/post text wrapped around the prompt at run time (settings panel → **Pre & post text**; hidden from app users; captured by presets). See [Prompt pre & post text](../../prompt-pre-post-text.md). |

## Inputs & Outputs

- **Inputs:** `in` -- source audio URL from an upstream audio node
- **Outputs:** `audio` -- generated cover audio URL
## Best Practices

- Provide a clear prompt describing the target style for the cover (e.g., "acoustic folk version" or "80s synthwave remix").
- Use the Instrumental toggle to create karaoke-style versions of songs.
- Supply custom lyrics if you want to change the words, not just the musical style.
- Pair with Suno Separate first to isolate vocals or instrumentals from the source before covering.
- Test with V4 models first before committing to V5 for final output.

## Common Use Cases

- Reimagining a track in a completely different genre.
- Creating instrumental or karaoke versions of existing songs.
- Changing vocal gender on an existing track.
- Producing style variations of a Suno Generate output.
- Building a workflow where generated music feeds into a cover for iterative refinement.

## Tips

- The source audio must be accessible via a public URL. Connect an upstream Suno Generate or upload node to provide it automatically.
- Custom Mode unlocks fine-grained control over style interpretation.
- Negative Style is particularly effective for covers -- use it to prevent the AI from retaining unwanted elements of the original.
