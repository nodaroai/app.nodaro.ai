# Duration
> Set a length in seconds for a script or a video.

## Overview

The Duration parameter node provides a numeric value (in seconds) that controls the target duration of content produced by connected downstream nodes. It is primarily used with Generate Script (to set the target video length), video generation nodes, and audio generation nodes. The value is passed as a parameter rather than being configured inline on each consuming node.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Seconds | number | `60` | Target duration in seconds. The downstream node interprets this value according to its own constraints (e.g., video providers have fixed duration options like 5s, 10s, 15s). |

## Inputs & Outputs

**Inputs:**
- `in` -- optional upstream input (rarely used; Duration is typically a root parameter node)

**Outputs:**
- `duration` -- numeric duration value in seconds. Connect it to:
  - Generate Script's **Duration** input, to set the script's target length (clamped to 5–600 seconds);
  - the **Settings** input of [Generate Video](../ai-video/generate-video.md#settings-input), to set the video's duration: it runs as the nearest length the model renders (a tie goes to the shorter one), and the run is priced at that length — 60 runs as 15 s on Seedance 2;
  - the **Settings** input of [Generate Video Pro](../ai-video/generate-video-pro.md), to set the total length to stitch (clamped to that node's range).

  Audio generation nodes don't take this connection.
## Supported Providers

Not applicable. This is a data-passing parameter node with no AI provider.

## Best Practices

- Set duration to match your intended output format: 15s for social media reels, 30-60s for short-form content, 60-180s for explainer videos.
- Video models render a fixed set of lengths (VEO 3.1: 4, 6 or 8 seconds). On Generate Video the Duration value is a target, and the closest length the model renders is used.
- For Generate Script, the duration influences how many scenes are generated and how long each scene's suggested duration is.

## Common Use Cases

- Setting the overall target length for a storyboard/script generation workflow.
- Controlling video clip duration when the same workflow is used for different output formats (short reel vs. longer video).
- Parameterizing template workflows so users can specify their desired output length.

## Tips

- The default value of 60 seconds is designed for Generate Script workflows. For individual video clips, you will typically want much shorter values (5-15 seconds).
- Duration interacts with Scene Count: a 60-second target with 10 scenes suggests ~6 seconds per scene, which aligns well with most video generation providers.
