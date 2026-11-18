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
## Motion video length

The server measures the motion video before anything is charged, and every price below is read from that measured length. A length you send (the API's `videoDuration`, MCP's `video_duration`, or a length stored on the node) is accepted for older clients and ignored.

The motion video must be between 3 seconds and the model's limit:

| Model | Character orientation `image` (the default) | Character orientation `video` |
|-------|---------------------------------------------|-------------------------------|
| Kling 2.6, Kling 3.0 | up to 10 s | up to 30 s |
| Wan Animate Move / Replace | up to 30 s | up to 30 s |

A video up to 0.05 seconds past the limit is accepted and priced at the limit. Anything else is refused before any credits are held, and no job is created:

- shorter than 3 seconds: `video_too_short` (400), "Motion Transfer needs a motion video of at least 3 seconds";
- longer than the limit: `video_too_long` (400), naming the limit and asking you to trim the video first;
- a video that cannot be read: `video_unreadable` (400), "The motion video could not be read".

The measured length is billed in whole seconds, rounded up, with the first 0.05 seconds past a whole second forgiven: 6.2 s is billed as 7 s, 10.04 s as 10 s.

## Supported Providers

- **Kling 2.6** — Standard motion transfer, 720p/1080p, 3-30s
- **Kling 3.0** — Premium quality, background source control, 3-30s
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

**Kling 3.0 at 720p** (and any size Kling runs as 720p: 480p, 580p, or none) is charged per second of the measured motion video. Its price row is the price of four seconds; a run is that row × the billed seconds ÷ 4, rounded up once. The hold is the charge: nothing is settled after the run.

| Billed seconds | Kling 3.0, 720p |
|----------------|-----------------|
| per second | 62.7<!-- credits-rate: kling-3.0-motion:720p:per-4s@0.25 --> |
| 3 s | 189 credits<!-- credits: kling-3.0-motion:720p:per-4s@0.75 --> |
| 10 s | 627 credits<!-- credits: kling-3.0-motion:720p:per-4s@2.5 --> |
| 30 s | 1881 credits<!-- credits: kling-3.0-motion:720p:per-4s@7.5 --> |

Worked examples: a 10-second motion video costs 627 credits<!-- credits: kling-3.0-motion:720p:per-4s@2.5 -->; a 3-second one costs 189 credits<!-- credits: kling-3.0-motion:720p:per-4s@0.75 -->.

**Kling 2.6 (both sizes) and Kling 3.0 at 1080p** are priced by the measured length, in tiers (up to 5 s, up to 10 s, up to 15 s, and longer at the 30 s price), and by size (1080p, or 720p for any other size):

| Length | Kling 2.6, 720p | Kling 2.6, 1080p | Kling 3.0, 1080p |
|--------|-----------------|------------------|------------------|
| up to 5 s | 88 credits<!-- credits: motion-transfer:5s --> | 132 credits<!-- credits: motion-transfer:1080p:5s --> | 275 credits<!-- credits: kling-3.0-motion:1080p:5s --> |
| up to 10 s | 165 credits<!-- credits: motion-transfer:10s --> | 253 credits<!-- credits: motion-transfer:1080p:10s --> | 550 credits<!-- credits: kling-3.0-motion:1080p:10s --> |
| up to 15 s | 253 credits<!-- credits: motion-transfer:15s --> | 374 credits<!-- credits: motion-transfer:1080p:15s --> | 825 credits<!-- credits: kling-3.0-motion:1080p:15s --> |
| longer | 495 credits<!-- credits: motion-transfer:30s --> | 748 credits<!-- credits: motion-transfer:1080p:30s --> | 1650 credits<!-- credits: kling-3.0-motion:1080p:30s --> |

The tier is the billed seconds' (so a 10.5-second video, billed as 11 s, is in the "up to 15 s" tier). Worked example: Kling 3.0 at 1080p with a 10-second motion video costs 550 credits<!-- credits: kling-3.0-motion:1080p:10s -->.

**The price you see before you run** reads the motion video's length from the workflow — an upload at its recorded length, a video another node makes in this run at the length it will produce plus a small allowance. When the length is not known, the price shown is the most the run can cost for its character orientation (a 10-second video with `image`, 30 seconds with `video`), marked as an estimate (≈). The run itself measures the real video.

## Best Practices

- Use a clear, full-body character image for best results
- Reference video should have clean, distinct movements
- Wan Animate is excellent for quick iterations before upgrading to Kling
- The motion video's length is measured by the server when the run starts; trim it to the model's limit first

## Common Use Cases

- Make AI-generated characters perform dance moves
- Create character animations from reference footage
- Transfer real-person movements to illustrated characters
- Generate consistent character videos from a single image

## Tips

- Kling 3.0 offers background source selection — use input_image for clean backgrounds or input_video to preserve the reference scene
- Wan Animate is faster than Kling — start there for testing
- Consider trimming reference video to only the needed motion segment
