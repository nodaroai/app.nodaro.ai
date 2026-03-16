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

## Credit Cost

### Kling 2.6

| Duration | 720p | 1080p |
|----------|------|-------|
| 5s | 10 | 15 |
| 10s | 19 | 29 |
| 15s | 29 | 43 |
| 30s | 57 | 85 |

### Kling 3.0

| Duration | 720p | 1080p |
|----------|------|-------|
| 5s | 19 | 32 |
| 10s | 38 | 63 |
| 15s | 57 | 94 |
| 30s | 113 | 188 |

### Wan Animate

| Provider | 480p | 580p | 720p |
|----------|------|------|------|
| wan-animate-move | 2 | 3 | 4 |
| wan-animate-replace | 2 | 3 | 4 |

## Supported Providers

- **Kling 2.6** — Standard motion transfer, 720p/1080p, 5-30s
- **Kling 3.0** — Premium quality, higher cost, background source control
- **Wan Animate Move** — Budget option (2-4cr), lower resolution
- **Wan Animate Replace** — Budget option, replaces character in motion video

## Best Practices

- Use a clear, full-body character image for best results
- Reference video should have clean, distinct movements
- Wan Animate (2-4cr) is excellent for quick iterations before upgrading to Kling
- Duration is auto-detected from the connected video when possible

## Common Use Cases

- Make AI-generated characters perform dance moves
- Create character animations from reference footage
- Transfer real-person movements to illustrated characters
- Generate consistent character videos from a single image

## Tips

- Kling 3.0 offers background source selection — use input_image for clean backgrounds or input_video to preserve the reference scene
- Wan Animate is 10-50x cheaper than Kling — start there for testing
- Longer durations scale linearly in cost, so consider trimming reference video to only the needed motion
