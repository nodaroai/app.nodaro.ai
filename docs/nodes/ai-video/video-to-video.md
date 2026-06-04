# Video to Video

> Transform existing video using AI with a text prompt.

## Overview

The Video to Video node applies AI-powered transformations to an existing video based on a text prompt. Use it for style transfer, content modification, or creative re-interpretation of video footage.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | Select | wan | AI model for transformation |
| Prompt | Textarea | — | Description of the desired transformation |

### Wan 2.7 VideoEdit — additional fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Duration | Select | Auto | Auto / 5s / 10s — target output length |
| Resolution | Select | 1080p | 720p or 1080p output |
| Audio | Select | Auto | Auto = AI-generated audio; Origin = keep source audio |
| Expand prompt | Checkbox | off | AI enhances the prompt before sending to KIE |
| Negative Prompt | Textarea | — | What to avoid in the output |
| Seed | Number | — | Seed for reproducible results |

## Inputs & Outputs

**Inputs:**
- Video (required) — source video to transform
- Image (optional) — reference image to guide style/content (wan-videoedit only)
- Text Prompt (optional) — from upstream node

**Outputs:**
- Transformed video URL

## Supported Providers

| Provider | Credits | Notes |
|----------|---------|-------|
| **Wan 2.6** (`wan`) | 18 cr | General-purpose V2V, reliable results |
| **Wan 2.6 Flash** (`wan-flash`) | 13 cr | Fast V2V with optional audio & multi-shot |
| **Wan 2.7 VideoEdit** (`wan-videoedit`) | 32 cr | Guided editing with reference image, audio control, prompt extend |
| **Luma Modify** (`luma-modify`) | 32 cr | Strong at style transfer and artistic modifications |
| **Runway Aleph** (`runway-aleph`) | 35 cr | High-quality transformations, flexible aspect ratio |
| **HappyHorse Edit** (`happyhorse-edit`) | 20 cr | Up to 60s input, 720p or 1080p output |

## Best Practices

- Keep source video short (5-10s) for best results
- Describe the transformation clearly: "change to anime style" rather than describing the entire scene
- For Wan 2.7 VideoEdit: connect a reference image to guide the visual style of the output
- Use **Expand prompt** when your prompt is very brief — the AI fills in cinematic details
- Test with the cheapest provider (Wan Flash) before upgrading to Runway or Luma

## Common Use Cases

- Apply artistic styles to recorded footage (painterly, anime, cinematic)
- Change scene characteristics (day to night, summer to winter)
- Create variations of existing video content
- Transform live-action footage into animated styles

## Tips

- V2V works best when the transformation is stylistic rather than structural — changing colors and textures works better than adding or removing objects
- For structural changes, consider using Image-to-Image on keyframes then Image-to-Video instead
- Use consistent prompts when processing multiple clips for a project
