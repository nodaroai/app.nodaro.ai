# Suno Mashup
> Blend two audio tracks into a single mashup using Suno AI.

## Overview

Suno Mashup takes two audio tracks and blends them together into a cohesive mashup. The node supports custom style tags, vocal gender selection, and model version choice. Both input tracks must be provided as audio URLs, either from upstream nodes or direct URLs. When Custom Mode is enabled, additional style and title controls become active.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Model | enum | `"V5"` | Suno model version: `V5`, `V4_5ALL`, `V4_5PLUS`, `V4_5`, `V4`. |
| Custom Mode | boolean | `false` | Enables style, title, negative style, and vocal gender controls. |
| Title | string (max 200) | `""` | Title for the mashup (requires Custom Mode). |
| Style | string (max 500) | `""` | Genre and style tags for the mashup (requires Custom Mode). |
| Negative Style | string (max 500) | `""` | Styles to avoid in the mashup (requires Custom Mode). |
| Vocal Gender | enum | auto | `"male"`, `"female"`, or unset for automatic selection (requires Custom Mode). |

## Inputs & Outputs

- **Inputs:** `audio1`, `audio2` -- two audio tracks to blend (both required)
- **Outputs:** `audio` -- mashup audio URL
## Best Practices

- Choose source tracks in compatible keys and tempos for the most musical results.
- Enable Custom Mode and use Style tags to guide the mashup toward a coherent genre.
- Use Negative Style to prevent the mashup from inheriting unwanted characteristics from either source track.
- Test with shorter source tracks first to evaluate blending quality before using full-length songs.
- Both inputs must be provided -- the node will not execute with only one track connected.

## Common Use Cases

- Combining two Suno-generated tracks into a single composition.
- Creating DJ-style mashups of vocals from one track with instrumentals from another.
- Blending different genre versions of the same song concept.
- Building remix workflows: Suno Generate (track A) + Suno Generate (track B) -> Suno Mashup.
- Combining a Suno Separate vocal output with a different instrumental.

## Tips

- This is the only Suno node that requires exactly two audio inputs (`audio1` and `audio2`).
- The `uploadUrlList` parameter internally expects a tuple of exactly two URLs.
- Custom Mode must be enabled before style and title fields take effect.
- Mashups are useful for iterative blending experiments.
