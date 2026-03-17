# Composite
> Multi-layer video compositor with positioning, blending, and opacity controls.

## Overview
The Composite node combines up to 4 video layers into a single composition. Each layer can be positioned, scaled, and blended independently. Unlike other composition nodes, the Composite node uses no AI -- the plan is built entirely on the client side based on the layer configuration. This makes it deterministic and free to use.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Layers | CompositeLayerConfig[] | `[]` | Up to 4 video layers, each with individual settings (see Layer Config below). |
| FPS | number | `30` | Frames per second. Options: `24`, `30`, `60`. |
| Duration | number (seconds) | `10` | Duration of the output. Range: 1--120 seconds. |
| Aspect Ratio | enum | `"16:9"` | Output aspect ratio. Options: `16:9`, `9:16`, `1:1`, `4:5`. |
| Background Color | hex string | `"#000000"` | Background color visible behind all layers. |

### Layer Configuration (per layer)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Position | enum | `"fullscreen"` | `fullscreen` (fills frame) or `positioned` (manual placement). |
| Blend Mode | enum | `"normal"` | Compositing blend mode. Options: `normal`, `multiply`, `screen`, `overlay`. |
| Opacity | number | `1` | Layer opacity. Range: 0--1. |
| Z-Index | number | `0` | Layer stacking order. Range: 0--10. Higher values render on top. |
| Start Frame | number | `0` | Frame at which this layer becomes visible. |
| X | percent | `0` | Horizontal position (only when Position is `positioned`). |
| Y | percent | `0` | Vertical position (only when Position is `positioned`). |
| Width | percent | `100` | Layer width (only when Position is `positioned`). |
| Height | percent | `100` | Layer height (only when Position is `positioned`). |

## Inputs & Outputs

**Inputs:**
- `video1` -- First video layer.
- `video2` -- Second video layer.
- `video3` -- Third video layer.
- `video4` -- Fourth video layer.

**Outputs:**
- `composition` -- Composite plan (JSON). Connect to a Render Video node for final output.
## Best Practices
- Use z-index to control which layers appear in front. Higher z-index renders on top.
- Set start frames to create sequential or staggered layer appearances.
- Use `screen` blend mode for light overlays and `multiply` for shadow/darkening effects.
- Reduce opacity for watermark or overlay layers.
- Use `positioned` mode with percentage-based dimensions for picture-in-picture layouts.

## Common Use Cases
- Picture-in-picture layouts (e.g., webcam overlay on screen recording).
- Split-screen comparisons (side-by-side or top-bottom).
- Layering a transparent motion graphic over footage.
- Creating multi-source compositions with timed layer entrances.
- Adding semi-transparent watermark or branding overlays.

## Tips
- This node is free because it requires no AI processing.
- All positioning uses percentages, making compositions resolution-independent.
- Maximum 4 layers. For more complex compositions, chain multiple Composite nodes or use the Video Composer node.
- The output is a plan that must be rendered through the Render Video node.
- Duration maximum is 120 seconds, shorter than other composition nodes (which allow up to 300 seconds).
