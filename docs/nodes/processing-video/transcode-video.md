# Transcode Video

> Convert video codec, quality, and resolution.

## Overview

The Transcode Video node re-encodes video with different codec, quality, resolution, and audio settings. Use it to optimize file size, change compatibility, or standardize format across clips. Settings are in a collapsible advanced panel.

## Configuration (Advanced Settings)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Codec | Select | h264 | Video codec: h264 (recommended), h265 (HEVC) |
| Quality (CRF) | Number | 23 | Constant Rate Factor: 0 (best) to 51 (worst) |
| Resolution | Select | original | Target: original, 1080p, 720p, 480p |
| Audio Bitrate | Select | 128k | Audio quality: 128k, 192k, 256k, 320k |

### Codec Notes

- **h264** — Universal compatibility, recommended for web and social media
- **h265 (HEVC)** — Better compression (smaller files), but less compatible with older devices

### Quality Guide

| CRF | Quality | Use Case |
|-----|---------|----------|
| 18 | Visually lossless | Archival, master copies |
| 23 | Good (default) | General purpose |
| 28 | Acceptable | Smaller file size, web delivery |
| 35+ | Low | Previews, thumbnails |

## Inputs & Outputs

**Inputs:** Video (required)
**Outputs:** Transcoded video
## Source file

When the video connected to this node is a generation result that kept its original file beside its playable copy (an HDR, 10-bit or HEVC video: see [Video originals and previews](../../design/video-original-and-preview.md)), the node works from that original, not from the copy, and still outputs an 8-bit H.264 MP4. An HDR picture (HLG or PQ) is converted to SDR first, by the same conversion as the result's playable copy, so the output looks like the copy you played; an HDR video you upload is converted the same way. All of a run's conversions together get up to 15 minutes; a video too long to convert in what is left is read as before: the playable copy, or an upload as it is. When a picture was converted, the job's output says so: `output_data.warningCode` is `hdr_tone_mapped`, with an English `warningMessage`. If the original cannot be used (it is gone, it is over the node's download limit, or converting it fails or would take too long), the node works from the playable copy, as before. The price is the same either way.

## Best Practices

- CRF 23 with h264 is the best default for most purposes
- Use h265 only when file size is a priority and target devices support it
- Downscale to 720p for social media previews to save processing time
- Higher audio bitrate (256k+) only matters for music-heavy content

## Common Use Cases

- Convert h265 video to h264 for wider compatibility
- Reduce file size of large AI-generated videos
- Standardize resolution before combining clips
- Optimize for specific platform requirements

## Tips

- Lower CRF = higher quality = larger file. Each 6-point increase roughly halves file size
- Transcoding to the same codec at the same quality still re-encodes — avoid unnecessary passes
