# Suno Add Vocals
> Add AI-generated vocals to an existing instrumental track.

## Overview

Suno Add Vocals takes an existing Suno audio track (typically an instrumental) and generates vocal content to accompany it. The node requires a Suno Task ID and Audio ID from an upstream node. Model selection is limited to the versions that support this operation: V6, V6 Wild, V6 Mini, V5.5, V5 and V4.5 Plus.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Model | enum | `"V6"` | Suno model version: `V6` (greater musical expression, more natural vocals, richer details), `V6_WILD` (bolder, more distinctive, less predictable), `V6_MINI` (lightweight and fast), `V5_5`, `V5`, `V4_5PLUS`. |
| Task ID | string | `""` | Suno task ID — inherited from a connected Suno node (the panel shows the inherited value under the field), or paste one manually to work with a track from an earlier session. A live connection takes precedence over a manual value. |
| Audio ID | string | `""` | Suno audio ID — inherited from the connected Suno node's **selected** track (switch tracks on the source node and this follows), or paste one manually. A live connection takes precedence over a manual value. |

## Inputs & Outputs

- **Inputs:** `audio` -- Suno task ID and audio ID from an upstream Suno node
- **Outputs:** `audio` -- audio URL with added vocals
## Best Practices

- Use this after generating an instrumental track (via Suno Generate with the Instrumental toggle on) to add vocals.
- `V6` (the default) produces the most natural and expressive vocal performances; `V6_WILD` takes more creative liberties.
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

- Not every Suno version supports this operation: the picker offers `V6`, `V6_WILD`, `V6_MINI`, `V5_5`, `V5` and `V4_5PLUS`.
- Task ID and Audio ID are resolved automatically from the upstream Suno node connection.
- This node is the counterpart to Suno Add Instrumental -- one adds vocals, the other adds instrumentals.
- The generated vocals (lyrics and melody) are determined by the AI based on the instrumental input. You cannot specify custom lyrics with this node.
- The source track must originate from a Suno node. For non-Suno audio, consider Upload Extend or other workflows.
