# Video Upscale

> Upscale video resolution using Topaz or VEO AI.

## Overview

The Video Upscale node enhances video resolution using AI upscaling. Choose between Topaz (factor-based scaling with quality enhancement) or VEO (fixed target resolutions). Unlike most processing nodes, upscaling costs credits due to AI processing.

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

## Credit Cost

| Provider | Credits | Notes |
|----------|---------|-------|
| topaz (1x) | 1 | Enhance only, no upscale |
| topaz (2x) | 19 | Recommended |
| topaz (4x) | 19 | Maximum upscale |
| veo-1080p | 2 | Upscale to 1080p |
| veo-4k | 38 | Upscale to 4K |

## Best Practices

- VEO 1080p (2cr) is the most cost-effective for moderate upscaling
- Use Topaz 2x for highest quality results
- Upscale after all other processing is complete to avoid re-processing at higher resolution
- 1x Topaz (enhance) improves quality without changing resolution

## Common Use Cases

- Upscale AI-generated 480p/720p video to 1080p for publishing
- Enhance video quality before final delivery
- Prepare content for high-resolution displays or large screens

## Tips

- Upscaling works best on clean source video — apply noise reduction or effects before upscaling
- VEO 4K (38cr) is expensive — only use for final deliverables that truly need 4K
- Topaz 1x enhance is great for improving quality without changing dimensions
