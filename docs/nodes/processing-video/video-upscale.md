# Upscale Video

> Upscale video resolution using Topaz or VEO AI.

## Overview

The Video Upscale node enhances video resolution using AI upscaling. Choose between Topaz (factor-based scaling with quality enhancement) or VEO (fixed target resolutions). Unlike most processing nodes, upscaling uses AI processing.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | Select | topaz | Upscaling engine |

### Topaz Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Upscale Factor | Select | 2 | 1x (enhance only), 2x (recommended), 4x (maximum) |

### VEO Options

Select target resolution: 1080p or 4K.

## Inputs & Outputs

**Inputs:** Video (required)
**Outputs:** Upscaled video
## Best Practices

- VEO 1080p is a good option for moderate upscaling
- Use Topaz 2x for highest quality results
- Upscale after all other processing is complete to avoid re-processing at higher resolution
- 1x Topaz (enhance) improves quality without changing resolution

## Common Use Cases

- Upscale AI-generated 480p/720p video to 1080p for publishing
- Enhance video quality before final delivery
- Prepare content for high-resolution displays or large screens

## Tips

- Upscaling works best on clean source video — apply noise reduction or effects before upscaling
- VEO 4K is the highest-quality option — only use for final deliverables that truly need 4K
- Topaz 1x enhance is great for improving quality without changing dimensions
