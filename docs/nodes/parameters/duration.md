# Duration
> Set a target duration in seconds for connected video or audio generation nodes.

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
- `duration` -- numeric duration value in seconds, consumed by downstream generation nodes

## Credit Cost

| Cost | Notes |
|------|-------|
| 0 credits | Parameter nodes are free -- they only pass data, no AI processing |

## Supported Providers

Not applicable. This is a data-passing parameter node with no AI provider.

## Best Practices

- Set duration to match your intended output format: 15s for social media reels, 30-60s for short-form content, 60-180s for explainer videos.
- Be aware that video generation providers have fixed duration options (e.g., Kling supports 5s or 10s, VEO3 is always 8s). The Duration value is used as a target, and the closest supported duration is selected.
- For Generate Script, the duration influences how many scenes are generated and how long each scene's suggested duration is.

## Common Use Cases

- Setting the overall target length for a storyboard/script generation workflow.
- Controlling video clip duration when the same workflow is used for different output formats (short reel vs. longer video).
- Parameterizing template workflows so users can specify their desired output length.

## Tips

- The default value of 60 seconds is designed for Generate Script workflows. For individual video clips, you will typically want much shorter values (5-15 seconds).
- Duration interacts with Scene Count: a 60-second target with 10 scenes suggests ~6 seconds per scene, which aligns well with most video generation providers.
