# Camera Motion
> Specify the camera movement type for connected video generation nodes.

## Overview

The Camera Motion parameter node defines the type of camera movement to apply in generated video content. It provides five standard camera motion presets that influence how the virtual camera behaves during video generation. This parameter is consumed by video generation nodes and script generation nodes to control the cinematographic feel of output clips.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Camera Motion | select | `"static"` | Camera movement type: `static`, `pan-left`, `pan-right`, `zoom-in`, `zoom-out` |

### Camera Motion Types

| Type | Description |
|------|-------------|
| `static` | No camera movement. Locked-off shot. Best for dialogue, product shots, and scenes where subject motion provides visual interest. |
| `pan-left` | Camera pans horizontally to the left. Reveals new scene elements from right to left. Good for establishing shots and landscape reveals. |
| `pan-right` | Camera pans horizontally to the right. Reveals new scene elements from left to right. Good for following subject movement or establishing shots. |
| `zoom-in` | Camera zooms into the subject. Creates focus and intimacy. Good for dramatic emphasis, reveals, and drawing attention to details. |
| `zoom-out` | Camera zooms out from the subject. Reveals context and environment. Good for establishing shots, endings, and showing scale. |

## Inputs & Outputs

**Inputs:**
- `in` -- optional upstream input (rarely used; Camera Motion is typically a root parameter node)

**Outputs:**
- `out` -- camera motion string, consumed by downstream video generation and script nodes

## Credit Cost

| Cost | Notes |
|------|-------|
| 0 credits | Parameter nodes are free -- they only pass data, no AI processing |

## Supported Providers

Not applicable. This is a data-passing parameter node with no AI provider.

## Best Practices

- Use "static" as the default when the scene's subject motion provides enough visual interest on its own.
- Alternate camera motions across consecutive scenes in a storyboard to create visual variety and maintain viewer engagement.
- Match camera motion to narrative intent: zoom-in for reveals and emphasis, zoom-out for context and conclusions, pans for environmental storytelling.
- Combine Camera Motion with the Motion parameter node for full control: Camera Motion defines how the camera moves, while Motion defines how much the subjects move.

## Common Use Cases

- Adding cinematic camera movement to AI-generated video clips.
- Creating consistent camera language across all scenes in a multi-clip storyboard.
- Parameterizing template workflows for different shooting styles (static documentary vs. dynamic action).

## Tips

- Camera motion is a hint to the video generation provider. Not all providers support all camera motion types natively. Some may approximate the requested motion through prompt engineering.
- The output handle is named `out` (not `cameraMotion`), which means it connects to the generic input on downstream nodes.
- For more complex camera movements (dolly, crane, tracking), describe them in the text prompt of the video generation node directly rather than using this parameter node.
