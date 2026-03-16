# Image to Video

> Generate video from a static image using 21+ AI video providers.

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

## Credit Cost

| Provider | Credits | Duration | Resolution |
|----------|---------|----------|------------|
| runway-kie | 4 | 5s | 720p |
| grok-i2v | 5-10 | 6-15s | 720p, duration-tiered |
| bytedance-lite | 6 | 5-10s | — |
| seedance | 4-11 | 4-12s | Duration-tiered |
| bytedance-pro | 8 | 5-10s | — |
| hailuo-2.3 | 8-13 | 6-10s | 768p, duration-tiered |
| hailuo-standard | 8-13 | 6-10s | 768p, duration-tiered |
| kling-turbo | 11-21 | 5-10s | 720p, duration-tiered |
| hailuo-2.3-pro | 12-23 | 6-10s | 768p, duration-tiered |
| wan-turbo | 13 | 5s | 480p |
| minimax | 18 | 5s | 1080p |
| wan-i2v | 18-53 | 5-15s | 720p, duration-tiered |
| veo3.1 | 19 | 8s | — |
| bytedance-pro-fast | 19 | 5-10s | — |
| kling | 14-56 | 5-10s | Audio doubles cost |
| sora2-pro | 38-158 | 5-10s | Standard/high quality |
| kling-master | 40-80 | 5-10s | Duration-tiered |
| kling-3.0 | 43-189 | 3-15s | 1080p, audio doubles |
| veo3 | 79 | 8s | — |
| sora2 | 8-9 | 5-10s | — |

Kling 3.0 costs scale with duration and audio: 5s no-audio = 43cr, 15s with audio = 189cr.

## Supported Providers

21 providers: minimax, veo3, veo3.1, kling, kling-turbo, kling-3.0, kling-master, seedance, hailuo-2.3-pro, hailuo-2.3, hailuo-standard, sora2-pro, sora2, wan-i2v, wan-turbo, bytedance-lite, bytedance-pro, bytedance-pro-fast, grok-i2v, runway-kie.

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

- Runway KIE (4cr) is the most cost-effective for quick previews
- VEO 3.1 Fast (19cr) offers a good quality/cost balance at 8 seconds
- Kling 3.0 with audio is expensive but produces sound-enabled video
- Connect a Camera Motion parameter node to control movement consistently across multiple I2V nodes
