# Extract Frame

> Pull a single still frame out of a video as a PNG image.

## Overview

The Extract Frame node converts a frame of video into a still image you can route into image-based nodes (modify, edit, upscale, generate-image as reference, etc.). Three pick modes:

- **First** — the first frame of the video
- **Last** — the final rendered frame (useful for chaining loops or grabbing a clean tail still)
- **Timestamp** — a specific second-precision offset (e.g., 2.5s into the clip)

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Mode | Select | first | `first` / `last` / `timestamp` |
| Timestamp (s) | Number | — | Seconds into the video. Only used when mode = `timestamp`. |

## Inputs & Outputs

**Inputs:** Video (required, connected upstream or via Upload Video)
**Outputs:** Image (PNG)

## Credit Cost

**1 credit** per extraction, regardless of mode or video length.

## Best Practices

- Use **last** mode to grab the closing frame of a generated video for use as the start frame of a follow-up i2v generation — that's the trick behind continuous multi-clip storytelling.
- Use **first** mode to verify what an upstream video starts with when chaining nodes.
- Timestamp mode honors decimals (e.g., `2.5` for 2.5 seconds in). Out-of-range timestamps clamp to the nearest valid frame.
- The output image inherits the video's resolution — to resize it before downstream use, route through Resize Video upstream or use a generative node's resolution control.

## Common Use Cases

- Capture the final frame of a VEO/Kling clip to seed the next i2v step (perfect-loop or storyboard-chain workflows).
- Pull a representative still for a thumbnail before posting to social.
- Extract a specific moment from a long video for editing or reference.
- Grab the start frame of an upstream clip to use as a reference image for a Generate Image node.

## Tips

- Frame extraction does NOT incur Topaz / VEO / KIE provider charges — it's a local FFmpeg operation costing one Nodaro credit for orchestration.
- The frame is exported as PNG (lossless), not JPEG — safe to route into upscale or edit-image without compression artifacts.
- Combine with **Combine Videos** to take a still from clip A, run it through Generate Image to remix, and stitch the result back into a new clip.
