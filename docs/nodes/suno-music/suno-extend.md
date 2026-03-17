# Suno Extend
> Extend an existing Suno-generated track by continuing from a specified timestamp.

## Overview

Suno Extend takes a previously generated Suno track (identified by its Audio ID) and continues the song from a given point. This is useful for lengthening songs, adding new sections, or building multi-part compositions. The node requires a Suno Audio ID from an upstream Suno node, not a raw audio URL.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Audio ID | string | `""` | Suno audio ID from an upstream Suno node (required). |
| Continue From | number (seconds) | `0` | Timestamp in seconds where the extension begins. |
| Extension Prompt | string (max 5000) | `""` | Prompt describing the desired continuation. |
| Model | enum | `"V5"` | Suno model version: `V5`, `V4_5ALL`, `V4_5PLUS`, `V4_5`, `V4`. |
| Title | string (max 80) | `""` | Title for the extended track. |
| Style | string (max 1000) | `""` | Genre and style tags for the extension. |
| Negative Style | string (max 500) | `""` | Styles to avoid in the extension. |
| Vocal Gender | enum | auto | `"male"`, `"female"`, or unset for automatic selection. |
| Style Weight | number | `0.5` | Influence of style tags (0.0 to 1.0). |
| Weirdness | number | `0.0` | Experimental output factor (0.0 to 1.0). |
| Audio Weight | number | `0.5` | Balance between prompt and source audio (0.0 to 1.0). |
| Use Default Parameters | boolean | `true` | When true, Suno uses its own defaults for advanced parameters. |

## Inputs & Outputs

- **Inputs:** `in` -- Suno audio ID from an upstream Suno node (e.g., Suno Generate)
- **Outputs:** `audio` -- extended audio URL
## Best Practices

- Set Continue From to the exact timestamp where you want new content to begin; setting it to 0 appends to the end.
- Use the Extension Prompt to describe the new section (e.g., "build to an epic chorus" or "fade out with ambient pads").
- Keep Use Default Parameters enabled unless you have specific requirements for style weight and weirdness.
- Chain multiple Suno Extend nodes to build progressively longer compositions section by section.
- The Title field has a shorter limit (80 chars) than other Suno nodes -- keep it concise.

## Common Use Cases

- Lengthening a generated song that ended too soon.
- Adding a bridge, outro, or additional verse to an existing track.
- Building a multi-part composition by chaining Suno Generate into multiple Suno Extend nodes.
- Iteratively refining a song by extending from specific moments.
- Creating long-form ambient or background music by repeated extension.

## Tips

- This node requires a Suno Audio ID, not a generic audio URL. It must be connected to an upstream Suno node (Generate, Cover, etc.).
- To extend audio from non-Suno sources, use the Suno Upload Extend node instead.
- The Extension Prompt supports up to 5000 characters, allowing for very detailed continuation instructions.
- When Use Default Parameters is off, Style Weight, Weirdness, and Audio Weight become active controls.
