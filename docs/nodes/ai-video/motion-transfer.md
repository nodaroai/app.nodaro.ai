# Motion Transfer

> Apply motion from a reference video to a static character image.

## Overview

The Motion Transfer node takes motion from a reference video and applies it to a character image, creating a video where the character performs the movements from the reference. Supports several models; every run is priced per second of the motion video.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | Select | kling | AI model for motion transfer |
| Prompt | Textarea | — | Optional motion description (max 8000 chars) |
| Character Orientation | Select | image | Kling only: image or video mode |
| Background Source | Select | input_video | Kling 3.0 only: input_video or input_image |
| Resolution | Select | 720p | Kling: 720p or 1080p. Wan Animate Replace: 480p, 580p or 720p. Wan Animate Move: 720p only (see [Pricing](#pricing)) |
| `promptPrefix` / `promptSuffix` | text | -- | Optional pre/post text wrapped around the prompt at run time (settings panel → **Pre & post text**; hidden from app users; captured by presets). See [Prompt pre & post text](../../prompt-pre-post-text.md). |

## Inputs & Outputs

**Inputs:**
- Character Image (required) — static image of the character
- Motion Reference Video (required) — source of movement

**Outputs:**
- Generated video with transferred motion
## Motion video length

The server reads the motion video's length before anything is charged, and every price below is read from that length. A length you send (the API's `videoDuration`, MCP's `video_duration`, or a length stored on the node) is accepted for older clients and ignored.

The motion video must be between 3 seconds and the model's limit:

| Model | Character orientation `image` (the default) | Character orientation `video` |
|-------|---------------------------------------------|-------------------------------|
| Kling 2.6, Kling 3.0 | up to 10 s | up to 30 s |
| Wan Animate Move / Replace | up to 30 s | up to 30 s |

A video up to 0.05 seconds past the limit is accepted and priced at the limit. Anything else is refused before any credits are held, and no job is created:

- shorter than 3 seconds: `video_too_short` (400), "Motion Transfer needs a motion video of at least 3 seconds";
- longer than the limit: `video_too_long` (400), naming the limit and asking you to trim the video first;
- a video that cannot be read: `video_unreadable` (400), "The motion video could not be read".

The length is billed in whole seconds, rounded up, with the first 0.05 seconds past a whole second forgiven: 6.2 s is billed as 7 s, 10.04 s as 10 s.

## Supported Providers

- **Kling 2.6** — Standard motion transfer, 720p/1080p, 3-30s
- **Kling 3.0** — Premium quality, background source control, 3-30s
- **Wan Animate Move** (`wan-animate-move`) — Lightweight option, 720p only (the only size it supports: a node or request naming 480p or 580p runs, and is charged, at 720p)
- **Wan Animate Replace** (`wan-animate-replace`) — Lightweight option, replaces character in motion video, 480p / 580p / 720p

## Pricing

Every model and size is charged per second of the motion video. Each price row is the price of four seconds; a run is that row × the billed seconds ÷ 4, rounded up once. The hold is the charge: nothing is settled after the run.

| Model, size | Per second | 3 s | 10 s | 30 s |
|-------------|------------|-----|------|------|
| Kling 2.6, 720p | 34.65<!-- credits-rate: motion-transfer:720p:per-4s@0.25 --> | 105 credits<!-- credits: motion-transfer:720p:per-4s@0.75 --> | 347 credits<!-- credits: motion-transfer:720p:per-4s@2.5 --> | 1040 credits<!-- credits: motion-transfer:720p:per-4s@7.5 --> |
| Kling 2.6, 1080p | 55.825<!-- credits-rate: motion-transfer:1080p:per-4s@0.25 --> | 169 credits<!-- credits: motion-transfer:1080p:per-4s@0.75 --> | 559 credits<!-- credits: motion-transfer:1080p:per-4s@2.5 --> | 1676 credits<!-- credits: motion-transfer:1080p:per-4s@7.5 --> |
| Kling 3.0, 720p | 62.7<!-- credits-rate: kling-3.0-motion:720p:per-4s@0.25 --> | 189 credits<!-- credits: kling-3.0-motion:720p:per-4s@0.75 --> | 627 credits<!-- credits: kling-3.0-motion:720p:per-4s@2.5 --> | 1881 credits<!-- credits: kling-3.0-motion:720p:per-4s@7.5 --> |
| Kling 3.0, 1080p | 83.05<!-- credits-rate: kling-3.0-motion:1080p:per-4s@0.25 --> | 250 credits<!-- credits: kling-3.0-motion:1080p:per-4s@0.75 --> | 831 credits<!-- credits: kling-3.0-motion:1080p:per-4s@2.5 --> | 2492 credits<!-- credits: kling-3.0-motion:1080p:per-4s@7.5 --> |

Kling runs as 720p at any size but 1080p (480p, 580p, or none). The 30-second column applies with character orientation `video`; with `image` (the default) Kling takes at most 10 seconds.

Worked examples: Kling 2.6 at 720p with a 10-second motion video costs 347 credits<!-- credits: motion-transfer:720p:per-4s@2.5 -->; Kling 3.0 at 720p with a 3-second one costs 189 credits<!-- credits: kling-3.0-motion:720p:per-4s@0.75 -->; Kling 3.0 at 1080p with a 10-second one costs 831 credits<!-- credits: kling-3.0-motion:1080p:per-4s@2.5 -->.

**Wan Animate** (Move and Replace) is charged per second too, but never less than its flat price for the size: a run costs whichever is larger. Short videos cost the flat price; longer ones cost their per-second price.

| Model, size | Per second | Never less than | Per second from | 30 s |
|-------------|------------|-----------------|-----------------|------|
| Wan Animate Replace, 480p | 16.5<!-- credits-rate: wan-animate-replace:480p:per-4s@0.25 --> | 281 credits<!-- credits: wan-animate-replace --> | 18 s | 495 credits<!-- credits: wan-animate-replace:480p:per-4s@7.5 --> |
| Wan Animate Replace, 580p | 26.125<!-- credits-rate: wan-animate-replace:580p:per-4s@0.25 --> | 363 credits<!-- credits: wan-animate-replace:580p --> | 14 s | 785 credits<!-- credits: wan-animate-replace:580p:per-4s@7.5 --> |
| Wan Animate Replace, 720p | 34.375<!-- credits-rate: wan-animate-replace:720p:per-4s@0.25 --> | 451 credits<!-- credits: wan-animate-replace:720p --> | 14 s | 1032 credits<!-- credits: wan-animate-replace:720p:per-4s@7.5 --> |
| Wan Animate Move, 720p | 34.375<!-- credits-rate: wan-animate-move:720p:per-4s@0.25 --> | 451 credits<!-- credits: wan-animate-move:720p --> | 14 s | 1032 credits<!-- credits: wan-animate-move:720p:per-4s@7.5 --> |

Wan Animate Move runs at 720p, the only size it supports: a node or request naming 480p or 580p runs, and is charged, at 720p, and the editor offers 720p only for it. A Wan Animate run with no size runs at 720p. A size Wan Animate does not have (1080p, which the API accepts for the Kling models; 480p and 580p on Move) runs, and is charged, as 720p: the API answer then carries an `adjustments` entry (for example `resolution` from `1080p` to `720p`), and a workflow written through MCP stores 720p on the node.

Worked examples:

- Wan Animate Replace at 720p, a 3-second motion video: 451 credits<!-- credits: wan-animate-replace:720p -->, its flat price (13 seconds costs the same).
- Wan Animate Replace at 720p, a 14-second motion video: 482 credits<!-- credits: wan-animate-replace:720p:per-4s@3.5 -->.
- Wan Animate Replace at 720p, a 30-second motion video: 1032 credits<!-- credits: wan-animate-replace:720p:per-4s@7.5 -->.
- Wan Animate Move at 480p, a 30-second motion video: runs at 720p, 1032 credits<!-- credits: wan-animate-move:720p:per-4s@7.5 -->.

**The price you see before you run** reads the motion video's length from the workflow — an upload at its recorded length, a video another node makes in this run at the length it will produce plus a small allowance. When the length is not known, the price shown is the most the run can cost for its character orientation (a 10-second video with `image`, 30 seconds with `video`), marked as an estimate (≈). The run itself reads the real video's length.

## Best Practices

- Use a clear, full-body character image for best results
- Reference video should have clean, distinct movements
- Wan Animate is excellent for quick iterations before upgrading to Kling
- The server reads the motion video's length when the run starts; trim it to the model's limit first

## Common Use Cases

- Make AI-generated characters perform dance moves
- Create character animations from reference footage
- Transfer real-person movements to illustrated characters
- Generate consistent character videos from a single image

## Tips

- Kling 3.0 offers background source selection — use input_image for clean backgrounds or input_video to preserve the reference scene
- Wan Animate is faster than Kling — start there for testing
- Consider trimming reference video to only the needed motion segment
