# Text to Video

> Generate video directly from a text description using 15+ AI providers.

## Overview

The Text to Video node creates video from a text prompt without requiring a source image. Ideal for generating original footage, abstract visuals, or scenes described entirely through text. Supports multiple providers with varying quality, duration, and cost.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | Select | minimax | AI model for generation |
| Prompt | Textarea | — | Description of the video to generate |
| Duration | Select/Number | Provider-specific | Video length in seconds |
| Aspect Ratio | Select | 16:9 | Output dimensions: 16:9, 9:16, 1:1 |
| Negative Prompt | Textarea | — | Elements to avoid in the output |

### Provider-Specific Options

| Provider | Extra Fields |
|----------|-------------|
| sora2, sora2-pro | Remove Watermark checkbox (+4 CR) |
| kling | Enable Sound checkbox |
| kling-turbo | CFG Scale (0-1) |
| kling-3.0 | Continuous 3-15s duration, Audio option, dedicated studio config |

## Inputs & Outputs

**Inputs:**
- Text Prompt (optional) — from upstream Text Prompt node
- Provider (optional) — from upstream Provider node

**Outputs:**
- Generated video URL

## Credit Cost

| Provider | Credits | Duration | Notes |
|----------|---------|----------|-------|
| runway-kie | 4 | 5s | 720p, most affordable |
| grok | 5-10 | 6-15s | Via grok-i2v pricing |
| bytedance-lite | 6 | 5-10s | |
| seedance | 4-11 | 4-12s | Duration-tiered |
| bytedance-pro | 8 | 5-10s | |
| hailuo-standard | 8-13 | 6-10s | Duration-tiered |
| sora2 | 8-9 | 5-10s | |
| wan-turbo | 25 | 5s | Via wan-turbo-t2v |
| kling-turbo | 11-21 | 5-10s | Duration-tiered |
| kling | 14-28 | 5-10s | Audio doubles cost |
| minimax | 18 | 5s | 1080p |
| veo3.1 | 19 | 8s | Fast mode |
| wan-t2v | 33 | 5s | 1080p |
| sora2-pro | 38-158 | 5-10s | Standard/high quality |
| kling-3.0 | 43-189 | 3-15s | Audio doubles cost |
| veo3 | 79 | 8s | Quality mode |

## Best Practices

- Write detailed, cinematic prompts describing action, lighting, and mood
- Use negative prompts to avoid common artifacts (blurry, distorted faces, etc.)
- For consistent style across clips, use the same provider and similar prompt structure
- Portrait (9:16) works best for social media content; landscape (16:9) for YouTube/presentations
- Start with cheaper providers (Runway KIE, Sora2 Standard) for prompt iteration

## Common Use Cases

- Generate original video content from written scripts
- Create social media video ads from copy
- Produce abstract or artistic video backgrounds
- Generate stock footage alternatives
- Rapid prototyping of video concepts

## Tips

- Text-to-Video generally produces less controllable results than Image-to-Video — use I2V when you need specific visual consistency
- Kling 3.0 is the only provider offering continuous duration control (3-15s)
- VEO 3 generates audio by default — useful for scene-appropriate sound
