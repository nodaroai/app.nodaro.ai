# Suno Convert WAV
> Convert a Suno-generated MP3 audio track to lossless WAV format.

## Overview

Suno Convert WAV takes a Suno-generated audio track and converts it from compressed MP3 format to uncompressed WAV format. This is useful when higher audio quality is needed for downstream processing, professional production, or archival purposes. The node requires a Suno Task ID and Audio ID from an upstream node. No additional configuration is needed.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Task ID | string | `""` | Suno task ID from an upstream Suno node (resolved automatically). |
| Audio ID | string | `""` | Suno audio ID from an upstream Suno node (resolved automatically). |

No additional configuration fields. The conversion is automatic.

## Inputs & Outputs

- **Inputs:** `audio` -- Suno task ID and audio ID from an upstream Suno node
- **Outputs:** `audio` -- WAV format audio URL

## Credit Cost

- **Fixed:** 1 credit

## Best Practices

- Place this node at the end of a Suno workflow when you need lossless output for production use.
- WAV files are significantly larger than MP3 -- consider storage implications before converting.
- Use this before feeding audio into FFmpeg processing nodes that benefit from lossless input.
- Not all downstream use cases require WAV -- skip this node if MP3 quality is sufficient.
- At 1 credit, the cost is negligible so convert proactively when quality matters.

## Common Use Cases

- Converting generated music to lossless format for professional mixing and mastering.
- Preparing audio for video production pipelines that require uncompressed audio.
- Archiving high-quality versions of Suno-generated tracks.
- Feeding lossless audio into downstream audio processing nodes (mix, adjust volume, etc.).
- Meeting format requirements for platforms or tools that do not accept MP3.

## Tips

- This is one of the simplest Suno nodes -- no configuration beyond the automatic Task ID and Audio ID resolution.
- At 1 credit, this is tied with Suno Style Boost as the cheapest Suno operation.
- The source track must originate from a Suno node. This is not a general-purpose audio format converter.
- WAV output will be uncompressed PCM audio, resulting in much larger file sizes than the source MP3.
