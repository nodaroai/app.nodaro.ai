# Suno Replace Section
> Replace a specific time range within a Suno-generated track with new content.

## Overview

Suno Replace Section targets a precise time range within an existing Suno track and regenerates that portion based on a prompt and style tags. This allows surgical editing of specific sections (e.g., replacing a weak verse or changing a chorus) without regenerating the entire song. The node requires a Suno Task ID and Audio ID from an upstream node.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Start Time | number (seconds) | `0` | Beginning of the section to replace (minimum 0). |
| End Time | number (seconds) | `30` | End of the section to replace. The replaced **interval** (End − Start) must be between 6 and 60 seconds and at most 50% of the song — the end timestamp itself can be anywhere in the track (e.g. 100s→130s is valid). |
| Prompt | string (max 3000) | `""` | The new lyrics/content for the replaced section (required). |
| Tags | string (max 500) | `""` | Style/genre tags for the replacement section (required). |
| Title | string (max 200) | `""` | Optional title for the replacement. |
| Full Lyrics | string | `""` | Complete post-edit lyrics of the **whole song** — modified and unmodified parts combined. Suno uses it as the full lyric sheet after the replacement. |
| Negative Tags | string (max 500) | `""` | Styles to exclude from the replacement segment (e.g. "rock"). |
| Task ID | string | `""` | Suno task ID — auto-filled from a connected Suno node, or paste one manually to edit a track from an earlier session. |
| Audio ID | string | `""` | Suno audio ID — auto-filled from a connected Suno node, or paste one manually. |
| `promptPrefix` / `promptSuffix` | text | -- | Optional pre/post text wrapped around the prompt at run time (settings panel → **Pre & post text**; hidden from app users; captured by presets). See [Prompt pre & post text](../../prompt-pre-post-text.md). |

## Inputs & Outputs

- **Inputs:** `audio` -- Suno task ID and audio ID from an upstream Suno node
- **Outputs:** `audio` -- modified audio URL with the replaced section
## Best Practices

- Keep the replacement window (End − Start) between 6 and 60 seconds -- shorter or longer intervals are not supported. The window can sit anywhere in the track.
- Provide Full Lyrics (the complete post-edit lyric sheet) so Suno blends the replacement into the song's overall lyrics coherently.
- Provide both a descriptive prompt and relevant tags for the best replacement quality.
- Listen to the source track carefully to identify precise start and end timestamps before replacing.
- Use this node iteratively to refine individual sections without affecting the rest of the song.
- This is efficient for iterative editing compared to full regeneration.

## Common Use Cases

- Fixing a weak verse or chorus in an otherwise good generation.
- Changing the mood or style of a specific song section.
- Replacing lyrics in a targeted section while keeping the rest intact.
- Iterative song refinement: generate a full track, then surgically improve individual parts.
- Experimenting with different bridges or transitions between sections.

## Tips

- The replaced interval (End − Start) must be 6–60 seconds; the timestamps themselves are unrestricted.
- Both Task ID and Audio ID are resolved automatically when connected to an upstream Suno node — a live connection overrides manual values. Copy them from a Suno Generate node (shown under its player) to edit a track from an earlier session.
- The Tags field is required by the backend validation -- always provide at least basic genre tags.
- This is one of the most cost-efficient Suno nodes, making it ideal for iterative refinement workflows.
