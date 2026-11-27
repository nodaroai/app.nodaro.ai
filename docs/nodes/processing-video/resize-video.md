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
**Outputs:** `video-out` — resized video
## Source file

When the video connected to this node is a generation result that kept its original file beside its playable copy (an HDR, 10-bit or HEVC video: see [Video originals and previews](../../design/video-original-and-preview.md)), the node works from that original, not from the copy, and still outputs an 8-bit H.264 MP4. An HDR picture (HLG or PQ) is converted to SDR first, by the same conversion as the result's playable copy, so the output looks like the copy you played; an HDR video you upload is converted the same way. All of a run's conversions together get up to 15 minutes; a video too long to convert in what is left is read as before: the playable copy, or an upload as it is. When a picture was converted, the job's output says so: `output_data.warningCode` is `hdr_tone_mapped`, with an English `warningMessage`. If the original cannot be used (it is gone, it is over the node's download limit, or converting it fails or would take too long), the node works from the playable copy, as before. The price is the same either way.

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
