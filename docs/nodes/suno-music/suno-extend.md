# Suno Extend
> Extend an existing Suno-generated track by continuing from a specified timestamp.

## Overview

Suno Extend takes a previously generated Suno track (identified by its Audio ID) and continues the song from a given point. This is useful for lengthening songs, adding new sections, or building multi-part compositions. The node requires a Suno Audio ID from an upstream Suno node, not a raw audio URL.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Audio ID | string | `""` | Suno audio ID (required). Inherited from the connected Suno node's **selected** track — the panel shows "Inherited from *Suno Generate*: `<id>`" under the field, so nothing needs pasting; switch tracks on the source node and Extend follows. A manual value applies only without a connection. |
| Continue From | number (seconds) | `0` | Timestamp in seconds where the extension begins. Must be greater than 0; leave it at 0 (or empty) and the node extends the track using Suno's own parameters instead of the custom ones. |
| Extension Prompt | string | `""` | Prompt describing the desired continuation. Max length is per-version (5000 for V4.5+/V5, 3000 for V4); longer input is truncated rather than rejected. |
| Model | enum | `"V5"` | Suno model version: `V5`, `V4_5ALL`, `V4_5PLUS`, `V4_5`, `V4`. |
| Title | string (max 80) | `""` | Title for the extended track. |
| Style | string (max 1000) | `""` | Genre and style tags for the extension. Max **1000** for V4.5+/V5, **200** for V4. |
| Negative Style | string (max 500) | `""` | Styles to avoid in the extension. |
| Vocal Gender | enum | auto | `"male"`, `"female"`, or unset for automatic selection. |
| Style Weight | number | `0.5` | Influence of style tags (0.0 to 1.0). |
| Weirdness | number | `0.0` | Experimental output factor (0.0 to 1.0). |
| Audio Weight | number | `0.5` | Balance between prompt and source audio (0.0 to 1.0). |
| Use Default Parameters | boolean | `true` | When true, the extension uses your own Style, Title, Negative Style, and Continue From instead of Suno's defaults; when false, Suno applies its own default extension parameters (the same fallback that happens when Continue From is left at 0). |
| `promptPrefix` / `promptSuffix` | text | -- | Optional pre/post text wrapped around the prompt at run time (settings panel → **Pre & post text**; hidden from app users; captured by presets). See [Prompt pre & post text](../../prompt-pre-post-text.md). |

## Inputs & Outputs

- **Inputs:** `in` -- Suno audio ID from an upstream Suno node (e.g., Suno Generate)
- **Outputs:** `audio` -- extended audio URL
## Best Practices

- Set Continue From to the exact timestamp where you want new content to begin. It must be greater than 0 and less than the track's length; leaving it at 0 falls back to Suno's default extension parameters (Style, Title and Negative Style are then ignored).
- Use the Extension Prompt to describe the new section (e.g., "build to an epic chorus" or "fade out with ambient pads").
- Turn Use Default Parameters on when you need control over style weight and weirdness; leave it off to let Suno apply its own defaults for the extension.
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
- The Extension Prompt's max length is per-version (5000 for V4.5+/V5, 3000 for V4); longer input is truncated rather than rejected.
- Style Weight, Weirdness, and Audio Weight are only active controls when Use Default Parameters is set to true; turn it off to let Suno apply its own defaults instead.
