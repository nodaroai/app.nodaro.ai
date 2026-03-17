# Suno Add Vocals
> Add AI-generated vocals to an existing instrumental track.

## Overview

Suno Add Vocals takes an existing Suno audio track (typically an instrumental) and generates vocal content to accompany it. The node requires a Suno Task ID and Audio ID from an upstream node. Model selection is limited to V5 and V4.5 Plus, which are the versions that support this operation.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Model | enum | `"V5"` | Suno model version: `V5` or `V4_5PLUS`. |
| Task ID | string | `""` | Suno task ID from an upstream Suno node (resolved automatically). |
| Audio ID | string | `""` | Suno audio ID from an upstream Suno node (resolved automatically). |

## Inputs & Outputs

- **Inputs:** `audio` -- Suno task ID and audio ID from an upstream Suno node
- **Outputs:** `audio` -- audio URL with added vocals
## Best Practices

- Use this after generating an instrumental track (via Suno Generate with the Instrumental toggle on) to add vocals.
- V5 typically produces more natural and expressive vocal performances.
- For best results, ensure the source instrumental has a clear melodic structure the AI can follow.
- Combine with Suno Separate to swap vocals: extract instrumentals from one track, then add new vocals.
- The AI will generate lyrics and melody automatically based on the instrumental's characteristics.

## Common Use Cases

- Adding vocals to an instrumental-only Suno generation.
- Re-vocaling a track after separating and discarding the original vocals.
- Creating vocal versions of backing tracks or beats.
- Building remix workflows: Suno Generate (instrumental) -> Suno Add Vocals.
- Layering new vocal performances onto existing instrumental arrangements.

## Tips

- Only two model versions are available for this operation: V5 and V4.5 Plus.
- Task ID and Audio ID are resolved automatically from the upstream Suno node connection.
- This node is the counterpart to Suno Add Instrumental -- one adds vocals, the other adds instrumentals.
- The generated vocals (lyrics and melody) are determined by the AI based on the instrumental input. You cannot specify custom lyrics with this node.
- The source track must originate from a Suno node. For non-Suno audio, consider Upload Extend or other workflows.
