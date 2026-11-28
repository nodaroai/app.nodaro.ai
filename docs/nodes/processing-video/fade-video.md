# Fade In/Out

> Add fade transitions to the beginning and end of video.

## Overview

The Fade In/Out node adds smooth fade transitions to video. Configure fade-in, fade-out, or both, with black or white fade color. Each fade is independently toggleable with its own duration.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Fade Color | Select | black | Fade to/from: black or white |
| Fade In | Boolean | true | Enable fade-in at start |
| Fade In Duration | Number | 0.5 | Fade-in length: 0.1-3.0 seconds |
| Fade Out | Boolean | true | Enable fade-out at end |
| Fade Out Duration | Number | 0.5 | Fade-out length: 0.1-3.0 seconds |

## Inputs & Outputs

**Inputs:** Video (required)
**Outputs:** Video with fade transitions
## Source file

When the video connected to this node is a generation result that kept its original file beside its playable copy (an HDR, 10-bit or HEVC video: see [Video originals and previews](../../design/video-original-and-preview.md)), the node works from that original, not from the copy, and still outputs an 8-bit H.264 MP4. An HDR picture (HLG or PQ) is converted to SDR first, by the same conversion as the result's playable copy, so the output looks like the copy you played; an HDR video you upload is converted the same way. All of a run's conversions together get up to 15 minutes; a video too long to convert in what is left is read as before: the playable copy, or an upload as it is. When a picture was converted, the job's output says so: `output_data.warningCode` is `hdr_tone_mapped`, with an English `warningMessage`. If the original cannot be used (it is gone, it is over the node's download limit, or converting it fails or would take too long), the node works from the playable copy, as before. The price is the same either way.

## Best Practices

- 0.5s is a good default for most content
- Use longer fades (1-2s) for cinematic or dramatic content
- Black fades are standard for most video; white fades work well for bright, upbeat content
- Apply after all other processing to avoid fades being cut by downstream trim/combine

## Common Use Cases

- Add professional intro/outro transitions to any video
- Smooth the beginning of AI-generated clips that start abruptly
- Create dreamy or dramatic transitions between scenes

## Tips

- Fade In/Out only affects the start and end — for transitions between clips, use Combine Videos with transitions
- Fade-in and fade-out can have different durations for asymmetric timing
