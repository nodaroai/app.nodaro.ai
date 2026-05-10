# Video to Video

> Transform existing video using AI with a text prompt.

## Overview

The Video to Video node applies AI-powered transformations to an existing video based on a text prompt. Use it for style transfer, content modification, or creative re-interpretation of video footage.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | Select | wan | AI model for transformation |
| Prompt | Textarea | — | Description of the desired transformation |

## Inputs & Outputs

**Inputs:**
- Video (required) — source video to transform
- Text Prompt (optional) — from upstream node

**Outputs:**
- Transformed video URL
## Supported Providers

- **Wan** (22cr) — Good general-purpose V2V with reliable results
- **Luma Modify** (32cr) — Strong at style transfer and artistic modifications
- **Runway Aleph** (35cr) — High-quality transformations
- **HappyHorse Edit** (`happyhorse-edit`) — video-to-video transformation, up to 60s input, 720p or 1080p

## Best Practices

- Keep source video short (5-10s) for best results
- Describe the transformation clearly: "change to anime style" rather than describing the entire scene
- Use consistent prompts when processing multiple clips for a project
- Test with the cheapest provider (Wan) before upgrading to Luma or Runway

## Common Use Cases

- Apply artistic styles to recorded footage (painterly, anime, cinematic)
- Change scene characteristics (day to night, summer to winter)
- Create variations of existing video content
- Transform live-action footage into animated styles

## Tips

- V2V works best when the transformation is stylistic rather than structural — changing colors and textures works better than adding or removing objects
- For structural changes, consider using Image-to-Image on keyframes then Image-to-Video instead
