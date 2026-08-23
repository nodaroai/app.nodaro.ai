# Suno Add Instrumental
> Add an AI-generated instrumental backing track to an existing vocal track.

## Overview

Suno Add Instrumental takes an existing Suno audio track (typically one with isolated vocals) and generates a complementary instrumental arrangement to accompany it. The node requires a Suno Task ID and Audio ID from an upstream node. Model selection is limited to V5 and V4.5 Plus, which are the versions that support this operation.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Model | enum | `"V5_5"` | Suno model version: `V5_5`, `V5`, or `V4_5PLUS`. |
| Task ID | string | `""` | Suno task ID — inherited from a connected Suno node (the panel shows the inherited value under the field), or paste one manually to work with a track from an earlier session. A live connection takes precedence over a manual value. |
| Audio ID | string | `""` | Suno audio ID — inherited from the connected Suno node's **selected** track (switch tracks on the source node and this follows), or paste one manually. A live connection takes precedence over a manual value. |

## Inputs & Outputs

- **Inputs:** `audio` -- Suno task ID and audio ID from an upstream Suno node
- **Outputs:** `audio` -- audio URL with added instrumental
## Best Practices

- Use this after Suno Separate to add a new instrumental to isolated vocals.
- V5 generally produces higher quality instrumentals than V4.5 Plus for this node.
- Ensure the source track has clear vocals for the best instrumental matching.
- Pair with Suno Separate (vocal extraction) and then Add Instrumental for complete vocal re-arrangement workflows.
- The AI will attempt to match the genre, tempo, and key of the source audio automatically.

## Common Use Cases

- Adding backing music to an acapella or vocal-only track.
- Re-instrumenting a song after separating its original instrumental.
- Creating new arrangements of existing vocal performances.
- Building remix workflows: Suno Generate -> Suno Separate -> Suno Add Instrumental.
- Producing alternate instrumental versions of the same vocal take.

## Tips

- Only two model versions are available for this operation: V5 and V4.5 Plus.
- Task ID and Audio ID are resolved automatically from the upstream Suno node connection.
- This node is the counterpart to Suno Add Vocals -- one adds instrumentals, the other adds vocals.
- The source track must originate from a Suno node. For non-Suno audio, consider Upload Extend or other workflows.
