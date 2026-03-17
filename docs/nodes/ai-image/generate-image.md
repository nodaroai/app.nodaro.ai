# Generate Image
> Create AI-generated images from text prompts using 21 provider models with configurable style, aspect ratio, resolution, and quality.

## Overview

Generate Image is the primary text-to-image node. It accepts a text prompt (with optional style presets, negative prompts, and reference images) and produces an image via one of 21 AI providers. The default provider is Nano Banana Pro at 16:9 aspect ratio.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | select | `nano-banana-pro` | AI model to use for generation (21 options) |
| Prompt | text | `""` | Text description of the image to generate |
| Style | select | `""` | One of 16 presets (Photorealistic, Cinematic, Anime, Digital Art, Oil Painting, Watercolor, Children's Book, Comic Book, Pixel Art, 3D Render, Pencil Sketch, Pop Art, Minimalist, Retro/Vintage, Fantasy, Noir) or "Custom..." free text. Style text is appended to the prompt at execution time. |
| Negative Prompt | text | `""` | Elements to exclude. Sent natively for imagen4, ideogram, qwen; appended as "Avoid:..." for other providers. |
| Aspect Ratio | select | `"16:9"` | Provider-specific ratio sets (see table below) |
| Resolution | select | varies | Available for nano-banana-pro, nano-banana-2, flux, flux-flex only: 1K, 2K, 4K |
| Quality | select | varies | Available for gpt-image (medium/high) and seedream/seedream-5-lite (basic 2K / high 4K) |
| Rendering Speed | select | -- | Available for ideogram-v3: turbo, balanced, quality |
| Seed | number | -- | Reproducibility seed (supported by select providers) |
| Style Type | select | -- | Ideogram-specific style parameter |
| Expand Prompt | boolean | -- | Ideogram-specific prompt expansion toggle |
| Reference Images | image list | -- | Supported by nano-banana, nano-banana-pro, nano-banana-2 only. Upload or select from library. |
| Character/Asset References | references | -- | Connect Character, Object, or Location nodes for visual consistency |

## Inputs & Outputs

**Inputs:**
- `in` -- text prompt from upstream node (Text Prompt, AI Writer, etc.)

**Outputs:**
- `image` -- generated image URL
## Supported Providers

| Provider | Label | Description | Aspect Ratios |
|----------|-------|-------------|---------------|
| nano-banana | Nano Banana | Fast drafts, iteration, storyboards | 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 5:4, 4:5, 21:9 |
| nano-banana-pro | Nano Banana Pro | Higher detail, production-ready images | Same as Nano Banana |
| nano-banana-2 | Nano Banana 2 | Updated Nano Banana with web grounding | Same as Nano Banana |
| grok | Grok | Creative and stylized imagery | 1:1, 16:9, 9:16, 3:2, 2:3 |
| flux | Flux | Photorealistic, highest quality output | 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3 |
| flux-flex | Flux Flex | Flexible Flux, fast generation | Same as Flux |
| flux-kontext | Flux Kontext | Context-aware generation and editing | 1:1, 16:9, 9:16, 4:3, 3:4, 21:9 |
| flux-kontext-max | Flux Kontext Max | Highest quality Kontext generation | Same as Flux Kontext |
| gpt-image | GPT Image | Text rendering, complex compositions | 1:1, 3:2, 2:3 |
| imagen4 | Imagen 4 | Google's latest, strong prompt adherence | 1:1, 16:9, 9:16, 4:3, 3:4 |
| imagen4-fast | Imagen 4 Fast | Fast Imagen, lower latency | Same as Imagen 4 |
| imagen4-ultra | Imagen 4 Ultra | Highest quality Google image gen | Same as Imagen 4 |
| ideogram-v3 | Ideogram V3 | Fast text-to-image | 1:1, 16:9, 9:16, 4:3, 3:4 |
| qwen | Qwen | Versatile, good at diverse styles | 1:1, 16:9, 9:16, 4:3, 3:4 |
| seedream | Seedream | Photorealistic, high detail | 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 21:9 |
| seedream-5-lite | Seedream 5 Lite | Latest Seedream, fast and sharp | Same as Seedream |
| z-image | Z-Image | Fast, lightweight generation | 1:1, 16:9, 9:16, 4:3, 3:4 |

## Best Practices

- Use Nano Banana or Z-Image for rapid iteration and storyboarding due to fast generation speed.
- Use GPT Image for scenes requiring accurate text rendering (signs, labels, UI mockups).
- Append style presets rather than writing style instructions in the prompt -- the system handles appending automatically.
- For models that support reference images (nano-banana, nano-banana-pro, nano-banana-2), connect Character nodes upstream for consistent character appearance across shots.
- Set negative prompts for all providers to reduce unwanted artifacts. For imagen4/ideogram/qwen, the negative prompt is sent natively; for others it is appended as "Avoid:...".

## Common Use Cases

- Generating hero images for social media posts or ads.
- Creating storyboard frames from script scene descriptions.
- Producing product visualization shots with style consistency.
- Building character sheets by generating multiple angles with reference images.
- Creating background art or environment concepts for video compositions.

## Tips

- Use 1K resolution and medium quality during iteration, then switch to higher settings for final output.
- The style dropdown supports a "Custom..." option for free-text style descriptions when presets are insufficient.
- When connecting a Provider parameter node upstream, it overrides the provider selection on this node, which is useful for batch-switching models across multiple Generate Image nodes.
