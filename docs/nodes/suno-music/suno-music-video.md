# Suno Music Video
> Generate a music video for a Suno-generated track.

## Overview

Suno Music Video creates a visual music video to accompany a Suno-generated audio track. The node takes a Suno Task ID and Audio ID from an upstream Suno node and produces a video output synchronized to the music. Configuration is minimal -- the AI determines visual content based on the source track's characteristics.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Task ID | string | `""` | Suno task ID from an upstream Suno node (required). |
| Audio ID | string | `""` | Suno audio ID from an upstream Suno node (required). |

## Inputs & Outputs

- **Inputs:** `audio` -- Suno task ID and audio ID from an upstream Suno node
- **Outputs:** `video` -- generated music video URL
## Best Practices

- Ensure the upstream Suno node has completed successfully before running this node, as it requires valid task and audio IDs.
- Use descriptive prompts and style tags in the upstream Suno Generate node -- the music video AI uses the track's metadata to inform visual choices.
- This node produces video output (not audio), so downstream connections should accept video input.
- Combine with video processing nodes (resize, trim, add captions) for further refinement.

## Common Use Cases

- Generating a quick visual accompaniment for a Suno-generated song.
- Creating social media content by pairing generated music with auto-generated visuals.
- Producing music video drafts for review before professional production.
- Building end-to-end music pipelines: Suno Lyrics -> Suno Generate -> Suno Music Video.

## Tips

- This node has the simplest configuration of all Suno nodes -- just connect it to an upstream Suno audio node.
- The output is a video file, making it the only Suno node that outputs video rather than audio or text.
- It is a convenient way to visualize generated music.
- Task ID and Audio ID are automatically resolved when connected to an upstream Suno node in the workflow editor.
