# Suno Replace Section
> Replace a specific time range within a Suno-generated track with new content.

## Overview

Suno Replace Section targets a precise time range within an existing Suno track and regenerates that portion based on a prompt and style tags. This allows surgical editing of specific sections (e.g., replacing a weak verse or changing a chorus) without regenerating the entire song. The node requires a Suno Task ID and Audio ID from an upstream node.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Start Time | number (seconds) | `0` | Beginning of the section to replace (minimum 0). |
| End Time | number (seconds) | `30` | End of the section to replace (minimum 6, maximum 60). |
| Prompt | string (max 3000) | `""` | Description of the replacement content (required). |
| Tags | string (max 500) | `""` | Style/genre tags for the replacement section (required). |
| Title | string (max 200) | `""` | Optional title for the replacement. |
| Task ID | string | `""` | Suno task ID from an upstream Suno node (required, resolved automatically). |
| Audio ID | string | `""` | Suno audio ID from an upstream Suno node (required, resolved automatically). |

## Inputs & Outputs

- **Inputs:** `audio` -- Suno task ID and audio ID from an upstream Suno node
- **Outputs:** `audio` -- modified audio URL with the replaced section
## Best Practices

- Keep the replacement window between 6 and 60 seconds -- shorter or longer ranges are not supported.
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

- The End Time must be at least 6 seconds and at most 60 seconds. The minimum replacement length is 6 seconds.
- Both Task ID and Audio ID are resolved automatically when connected to an upstream Suno node.
- The Tags field is required by the backend validation -- always provide at least basic genre tags.
- This is one of the most cost-efficient Suno nodes, making it ideal for iterative refinement workflows.
