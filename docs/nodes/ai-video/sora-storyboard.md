# Sora Storyboard

> Create multi-shot video from individual scene descriptions.

## Overview

The Sora Storyboard node generates a multi-shot video using Sora 2 Pro. You define up to 10 individual shots, each with its own scene description and duration. The AI generates a cohesive video that transitions between shots, making it ideal for narrative content.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Duration (n_frames) | Select | 10 | Total frames: 10 (~5s), 15 (~10s), 25 (~15s) |
| Aspect Ratio | Select | landscape | landscape (16:9) or portrait (9:16) |

### Shots Editor

| Field | Type | Description |
|-------|------|-------------|
| Shots | Array (max 10) | List of shot definitions |
| Per-shot: Description | Textarea | Scene description for this shot |
| Per-shot: Duration | Number | Shot duration in seconds (1-10s) |

Add/remove shots dynamically. Each shot is independently described.

## Inputs & Outputs

**Inputs:**
- None required (all configuration is inline)

**Outputs:**
- Generated multi-shot video URL

## Credit Cost

| Frames | Approx Duration | Credits |
|--------|-----------------|---------|
| 10 | ~5 seconds | 47 |
| 15 | ~10 seconds | 85 |
| 25 | ~15 seconds | 85 |

## Best Practices

- Plan your shots before starting — write out the full storyboard sequence
- Keep individual shot descriptions focused on one action or scene
- Use landscape for cinematic content, portrait for social media
- Distribute duration across shots based on narrative pacing

## Common Use Cases

- Create short film sequences with multiple scenes
- Generate product showcase videos with different angles
- Build narrative social media content
- Produce storyboard previews for video production planning

## Tips

- 15 and 25 frames cost the same (85cr), so prefer 25 frames for longer content
- Each shot description should be self-contained — describe the full visual scene, not just changes from the previous shot
- For longer videos, chain multiple Sora Storyboard outputs with Combine Videos
