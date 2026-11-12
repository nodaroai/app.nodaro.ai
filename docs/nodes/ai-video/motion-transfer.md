# Motion Transfer

> Apply motion from a reference video to a static character image.

## Overview

The Motion Transfer node takes motion from a reference video and applies it to a character image, creating a video where the character performs the movements from the reference. Supports multiple providers with different resolution and duration tiers.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | Select | kling | AI model for motion transfer |
| Prompt | Textarea | — | Optional motion description (max 8000 chars) |
| Character Orientation | Select | image | Kling only: image or video mode |
| Background Source | Select | input_video | Kling 3.0 only: input_video or input_image |
| Resolution | Select | 720p | Kling: 720p or 1080p. Wan Animate: 480p, 580p or 720p (see [Pricing](#pricing)) |
| `promptPrefix` / `promptSuffix` | text | -- | Optional pre/post text wrapped around the prompt at run time (settings panel → **Pre & post text**; hidden from app users; captured by presets). See [Prompt pre & post text](../../prompt-pre-post-text.md). |

## Inputs & Outputs

**Inputs:**
- Character Image (required) — static image of the character
- Motion Reference Video (required) — source of movement

**Outputs:**
- Generated video with transferred motion
## Supported Providers

- **Kling 2.6** — Standard motion transfer, 720p/1080p, 5-30s
- **Kling 3.0** — Premium quality, background source control
- **Wan Animate Move** (`wan-animate-move`) — Lightweight option, 480p / 580p / 720p
- **Wan Animate Replace** (`wan-animate-replace`) — Lightweight option, replaces character in motion video, 480p / 580p / 720p

## Pricing

**Wan Animate** (Move and Replace) costs one flat price per run, by size, whatever the length of the motion video:

| Size | Wan Animate Move | Wan Animate Replace |
|------|------------------|---------------------|
| 480p | 281 credits<!-- credits: wan-animate-move --> | 281 credits<!-- credits: wan-animate-replace --> |
| 580p | 363 credits<!-- credits: wan-animate-move:580p --> | 363 credits<!-- credits: wan-animate-replace:580p --> |
| 720p | 451 credits<!-- credits: wan-animate-move:720p --> | 451 credits<!-- credits: wan-animate-replace:720p --> |

A Wan Animate run with no size runs at 720p. A size Wan Animate does not have (1080p, which the API accepts for the Kling models) runs, and is charged, as 720p: the API answer then carries an `adjustments` entry (`resolution` from `1080p` to `720p`), and a workflow written through MCP stores 720p on the node.

Worked examples:

- Wan Animate Move at 580p: 363 credits<!-- credits: wan-animate-move:580p -->.
- Wan Animate Replace at 1080p: runs at 720p, 451 credits<!-- credits: wan-animate-replace:720p -->.

**Kling 2.6 and Kling 3.0** are priced by the length of the motion video, rounded down to whole seconds, in tiers (up to 5 s, up to 10 s, up to 15 s, and longer at the 30 s price; 10 s when the length is not known), and by size (1080p, or 720p for any other size):

| Length | Kling 2.6, 720p | Kling 2.6, 1080p | Kling 3.0, 720p | Kling 3.0, 1080p |
|--------|-----------------|------------------|-----------------|------------------|
| up to 5 s | 88 credits<!-- credits: motion-transfer:5s --> | 132 credits<!-- credits: motion-transfer:1080p:5s --> | 165 credits<!-- credits: kling-3.0-motion:5s --> | 275 credits<!-- credits: kling-3.0-motion:1080p:5s --> |
| up to 10 s | 165 credits<!-- credits: motion-transfer:10s --> | 253 credits<!-- credits: motion-transfer:1080p:10s --> | 330 credits<!-- credits: kling-3.0-motion:10s --> | 550 credits<!-- credits: kling-3.0-motion:1080p:10s --> |
| up to 15 s | 253 credits<!-- credits: motion-transfer:15s --> | 374 credits<!-- credits: motion-transfer:1080p:15s --> | 495 credits<!-- credits: kling-3.0-motion:15s --> | 825 credits<!-- credits: kling-3.0-motion:1080p:15s --> |
| longer | 495 credits<!-- credits: motion-transfer:30s --> | 748 credits<!-- credits: motion-transfer:1080p:30s --> | 990 credits<!-- credits: kling-3.0-motion:30s --> | 1650 credits<!-- credits: kling-3.0-motion:1080p:30s --> |

Worked example: Kling 3.0 at 1080p with a 10-second motion video costs 550 credits<!-- credits: kling-3.0-motion:1080p:10s -->.

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
