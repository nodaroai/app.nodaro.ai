# Image to Video

> Generate video from a static image using 24+ AI video providers.

## Overview

The Image to Video node animates a still image into a video clip using state-of-the-art AI models. Connect an image source (Upload Image, Generate Image, etc.) and optionally provide a text prompt to guide the animation. Supports start/end frame mode for compatible providers.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | Select | minimax | AI model to use for generation |
| Prompt | Textarea | — | Text description guiding the animation |
| Duration | Select/Number | Provider-specific | Video length in seconds (fixed values per provider) |
| Motion | Select | moderate | Motion intensity: subtle, moderate, dynamic |
| Camera Motion | Select | static | Camera movement: static, pan-left, pan-right, zoom-in, zoom-out |
| Connected Image Ordering | Drag list | — | Reorder connected images (start/end frame selection) |

### Provider-Specific Options

| Provider | Extra Fields |
|----------|-------------|
| grok-i2v | Resolution (480p/720p), Mode (normal/fun/spicy) |
| sora2, sora2-pro | Quality (standard/high), Remove Watermark (+4 CR) |
| seedance | Resolution, Aspect Ratio (16:9/9:16/1:1/21:9), Camera Fixed, Generate Audio |
| seedance-2, seedance-2-fast | Resolution (480p/720p/1080p), Aspect Ratio, Duration (4–15s), Generate Audio, Web Search, NSFW Filter, multimodal references (image/video/audio) |
| veo3 | Generate Audio toggle |
| wan-i2v, wan-turbo | Resolution |
| hailuo | Resolution (512P/768P/1080P) |
| bytedance | Resolution, Camera Fixed, Seed |
| kling | Enable Sound checkbox |
| kling-turbo | CFG Scale (0-1) |
| kling-master | CFG Scale, Negative Prompt |
| kling-3.0 | Continuous duration 3-15s, Audio option (doubles cost), dedicated studio config |

### End Frame Support

These providers support both start and end frame images: minimax, veo3, veo3.1, kling-turbo, kling-3.0, hailuo-standard, bytedance-lite.

## Inputs & Outputs

**Inputs:**
- Image (required) — source image to animate
- Text Prompt (optional) — from upstream Text Prompt node
- End Frame Image (optional) — for supported providers

**Outputs:**
- Generated video URL
- Provider task metadata

## Supported Providers

25 providers: minimax, veo3, veo3.1, kling, kling-turbo, kling-3.0, kling-master, seedance, seedance-2, seedance-2-fast, hailuo-2.3-pro, hailuo-2.3, hailuo-standard, sora2-pro, sora2, wan-i2v, wan-turbo, wan-2.7-i2v, bytedance-lite, bytedance-pro, bytedance-pro-fast, grok-i2v, runway, happyhorse-i2v, happyhorse-ref2v.

Provider notes:
- **Wan 2.7 I2V** (`wan-2.7-i2v`) — 2–15s, 720p or 1080p, supports start+end frame input
- **HappyHorse I2V** (`happyhorse-i2v`) — 3–15s, 720p or 1080p, single start frame
- **HappyHorse Ref2V** (`happyhorse-ref2v`) — 3–15s, 720p or 1080p, 1–9 reference images
- **Seedance 2** (`seedance-2`) — ByteDance premium, 4–15s, 480p / 720p / 1080p, native audio, end frame + multimodal references (image/video/audio). Per-second pricing × resolution × reference-state. 8s @ 720p ≈ 82 cr (no ref) / 50 cr (with ref); 1080p ≈ 123 cr / 75 cr.
- **Seedance 2 Fast** (`seedance-2-fast`) — cheaper / quicker tier of seedance-2. Same matrix, lower per-second rate. 8s @ 720p ≈ 66 cr (no ref) / 40 cr (with ref); 1080p ≈ 99 cr / 60 cr.

## Best Practices

- Use high-quality, well-composed source images for best results
- Keep prompts descriptive but concise — describe the desired motion, not the image content
- Start with "moderate" motion and adjust based on results
- For longer videos, consider Kling 3.0 (up to 15s) or chain with Extend Video
- Use end frame mode when you need controlled start-to-end transitions

## Common Use Cases

- Animate product photos for social media ads
- Create cinematic scenes from AI-generated images
- Build video storyboards by animating each frame
- Generate B-roll footage from stock or generated images
- Create animated intros from logo/title images

## Tips

- Runway is a good option for quick previews
- VEO 3.1 Fast offers a good quality/speed balance at 8 seconds
- Kling 3.0 with audio produces sound-enabled video
- Connect a Camera Motion parameter node to control movement consistently across multiple I2V nodes

## Loop trim (smart-loop-cut)

Optional post-process that trims the output to its cleanest loop boundary using PSNR-based frame search. Replaces the legacy VEO-only fixed 8-frame trim.

**When to use it:**
- VEO 3.1 / Kling Turbo / Hailuo Standard / Bytedance Lite with both start AND end frames pinned to the same image (intentional perfect-loop output)
- Other i2v models if their output happens to drift toward the start frame at the end

**Configuration:**

| Field | Default | Description |
|---|---|---|
| Enabled | off | Toggle the post-process |
| Frames to test | 16 | How many trailing frames to PSNR-search (1-64) |
| Quality | Precise | "Precise" = frame-precise re-encode (libx264 crf=20). "Lossless" = keyframe-only stream-copy (byte-perfect, snaps to GOP boundary, supports any resolution including 4K). |

**Credit cost:**

Loop trim adds to the base i2v provider cost: `ceil(duration / 5) + ceil(framesToTest / 24)`, minimum 1 each.

| Configuration | Add-on |
|---|---|
| 8s output, framesToTest=16 | +3 credits |
| 8s output, framesToTest=64 | +5 credits |
| 5s output, framesToTest=16 | +2 credits |
| 60s output, framesToTest=16 | +13 credits |

Quality mode does NOT affect pricing — lossless is faster (no encode) but charges the same; the work the user pays for is the PSNR search.

**Partial-failure behavior:**

If the smart-loop-cut step fails after generation succeeds (e.g., source has fewer than 3 frames, ffmpeg crashes), the un-trimmed clip is kept and only the loop-trim addon is refunded. The user gets a working video and pays only for the work that succeeded.
