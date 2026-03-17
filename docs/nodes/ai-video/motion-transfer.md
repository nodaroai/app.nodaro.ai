# Motion Transfer

> Apply motion from a reference video to a static character image.

## Overview

The Motion Transfer node takes motion from a reference video and applies it to a character image, creating a video where the character performs the movements from the reference. Supports multiple providers with different resolution and duration tiers.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | Select | kling | AI model for motion transfer |
| Prompt | Textarea | — | Optional motion description (max 2500 chars) |
| Character Orientation | Select | image | Kling only: image or video mode |
| Background Source | Select | input_video | Kling 3.0 only: input_video or input_image |
| Resolution | Select | 720p | Provider-specific options |

## Inputs & Outputs

**Inputs:**
- Character Image (required) — static image of the character
- Motion Reference Video (required) — source of movement

**Outputs:**
- Generated video with transferred motion
## Supported Providers

- **Kling 2.6** — Standard motion transfer, 720p/1080p, 5-30s
- **Kling 3.0** — Premium quality, background source control
- **Wan Animate Move** — Lightweight option, lower resolution
- **Wan Animate Replace** — Lightweight option, replaces character in motion video

## Best Practices

- Use a clear, full-body character image for best results
- Reference video should have clean, distinct movements
- Wan Animate is excellent for quick iterations before upgrading to Kling
- Duration is auto-detected from the connected video when possible

## Common Use Cases

- Make AI-generated characters perform dance moves
- Create character animations from reference footage
- Transfer real-person movements to illustrated characters
- Generate consistent character videos from a single image

## Tips

- Kling 3.0 offers background source selection — use input_image for clean backgrounds or input_video to preserve the reference scene
- Wan Animate is faster than Kling — start there for testing
- Consider trimming reference video to only the needed motion segment
