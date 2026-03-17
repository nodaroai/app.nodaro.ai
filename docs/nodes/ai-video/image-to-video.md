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
## Supported Providers

21 providers: minimax, veo3, veo3.1, kling, kling-turbo, kling-3.0, kling-master, seedance, hailuo-2.3-pro, hailuo-2.3, hailuo-standard, sora2-pro, sora2, wan-i2v, wan-turbo, bytedance-lite, bytedance-pro, bytedance-pro-fast, grok-i2v, runway.

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
