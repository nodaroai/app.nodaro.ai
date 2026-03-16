# Suno Cover
> Create a cover version of an existing audio track using Suno AI.

## Overview

Suno Cover takes a source audio track and generates a new cover version of it. You can customize the output with different lyrics, style tags, vocal gender, and model selection. The source audio can be provided via a direct URL or connected from an upstream node.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Prompt | string (max 3000) | `""` | Description of how the cover should differ from the original. |
| Source Audio URL | URL | `""` | URL of the source audio to cover. Can be connected from an upstream node. |
| Model | enum | `"V5"` | Suno model version: `V5`, `V4_5ALL`, `V4_5PLUS`, `V4_5`, `V4`. |
| Title | string (max 200) | `""` | Title for the cover version. |
| Lyrics | string (max 3000) | `""` | Custom lyrics for the cover. Supports Suno metatags. |
| Style | string (max 500) | `""` | Genre and style tags for the cover. |
| Negative Style | string (max 500) | `""` | Styles to avoid in the cover. |
| Vocal Gender | enum | auto | `"male"`, `"female"`, or unset for automatic selection. |
| Custom Mode | boolean | `false` | Enables advanced parameter control. |
| Instrumental | boolean | `false` | When true, generates an instrumental cover (removes vocals). |

## Inputs & Outputs

- **Inputs:** `in` -- source audio URL from an upstream audio node
- **Outputs:** `audio` -- generated cover audio URL

## Credit Cost

- **V4 / V4.5 models:** 7 credits
- **V5 model:** 13 credits

## Best Practices

- Provide a clear prompt describing the target style for the cover (e.g., "acoustic folk version" or "80s synthwave remix").
- Use the Instrumental toggle to create karaoke-style versions of songs.
- Supply custom lyrics if you want to change the words, not just the musical style.
- Pair with Suno Separate first to isolate vocals or instrumentals from the source before covering.
- Test with V4 models first at lower credit cost before committing to V5 for final output.

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
