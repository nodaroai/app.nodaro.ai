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

## Supported Providers

minimax, veo3, kling, kling-turbo, kling-3.0, grok, sora2, sora2-pro, seedance, wan, wan-turbo, hailuo-standard, bytedance-lite, bytedance-pro, wan-2.7-t2v, happyhorse.

Provider notes:
- **Wan 2.7** (`wan-2.7-t2v`) — 2–15s, 720p or 1080p
- **HappyHorse** (`happyhorse`) — 3–15s, 720p or 1080p

## Best Practices

- Write detailed, cinematic prompts describing action, lighting, and mood
- Use negative prompts to avoid common artifacts (blurry, distorted faces, etc.)
- For consistent style across clips, use the same provider and similar prompt structure
- Portrait (9:16) works best for social media content; landscape (16:9) for YouTube/presentations
- Start with faster providers (Runway, Sora2 Standard) for prompt iteration

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
