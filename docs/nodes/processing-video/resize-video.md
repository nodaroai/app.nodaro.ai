# Resize Video

> Crop, pad, or stretch video to a target aspect ratio.

## Overview

The Resize Video node changes video dimensions to a target aspect ratio using crop, pad, or stretch methods. Useful for reformatting content between platforms (e.g., landscape to portrait).

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Target Aspect Ratio | Select | 16:9 | Output ratio: 1:1, 16:9, 9:16, 4:5 |
| Method | Select | crop | How to handle dimension mismatch |
| Pad Color | Color picker | #000000 | Background color for padding (pad method only) |

### Resize Methods

- **crop** — Cut edges to fit target ratio (may lose content)
- **pad** — Add colored bars to fit target ratio (preserves all content)
- **stretch** — Distort video to fill target ratio (not recommended)

## Inputs & Outputs

**Inputs:** Video (required)
**Outputs:** Resized video
## Best Practices

- Use "crop" for most cases — it looks more natural than padding
- Use "pad" when you can't afford to lose any content (e.g., text overlays near edges)
- Avoid "stretch" unless intentional — it distorts the image

## Common Use Cases

- Convert landscape (16:9) video to portrait (9:16) for TikTok/Reels
- Reformat to square (1:1) for Instagram feed
- Standardize dimensions before combining multiple clips

## Tips

- For platform-specific formatting with captions and preview, use Social Media Format instead
- Crop centers by default — if important content is off-center, consider using manual editing
