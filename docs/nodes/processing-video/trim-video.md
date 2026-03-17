# Trim Video

> Cut video to specific start and end times.

## Overview

The Trim Video node extracts a section of video between specified start and end times. Simple and precise — enter the timestamps in seconds and the node outputs the trimmed clip.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Start Time | Number | 0 | Start position in seconds |
| End Time | Number | — | End position in seconds |

## Inputs & Outputs

**Inputs:** Video (required)
**Outputs:** Trimmed video clip
## Best Practices

- Preview the source video first to identify exact trim points
- Leave Start Time at 0 if you only need to shorten the end
- Use before Combine Videos to select the best segments from multiple clips

## Common Use Cases

- Extract a specific scene from a longer video
- Remove unwanted intro/outro from generated video
- Cut AI-generated video to exact duration needed
- Prepare clips for combination or composition

## Tips

- Trim works in seconds with decimal precision (e.g., 2.5 for 2.5 seconds)
- If you only need audio from the video, use Trim Audio instead
