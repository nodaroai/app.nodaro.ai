# 3D Title
> AI-generated animated 3D text scenes with camera, lighting, and particle effects.

## Overview
The 3D Title node uses Claude Sonnet to generate a plan for animated 3D text scenes. The plan includes camera movements, lighting setups, and optional particle effects. Rendering uses `@remotion/three` with Three.js and `@react-three/drei` for high-quality 3D text animation. Maximum duration is 60 seconds.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Title Prompt | string | `""` | Natural language description of the desired 3D title animation. |
| FPS | number | `30` | Frames per second. Options: `24`, `30`, `60`. |
| Duration | number (seconds) | `10` | Duration of the output. Range: 1--60 seconds (hard maximum). |
| Aspect Ratio | enum | `"16:9"` | Output aspect ratio. Options: `16:9`, `9:16`, `1:1`, `4:5`. |
| Background Color | hex string | `"#000000"` | Scene background color. |

## Inputs & Outputs

**Inputs:**
- `background` -- Optional background image or video for the 3D scene.

**Outputs:**
- `composition` -- 3D title plan (JSON). Connect to a Render Video node for final output.
## Best Practices
- Describe the text content, animation style, and mood clearly (e.g., "epic gold title 'ADVENTURE' rotating with dramatic lighting").
- Keep duration short (5--15 seconds) for title cards; the 60-second maximum is a hard limit.
- Use a background image or video to give the 3D text more visual context.
- Specify camera behavior if important (e.g., "camera zooms out slowly" or "orbit around the text").

## Common Use Cases
- Creating animated title cards for video intros and outros.
- Generating 3D text reveals for presentations or trailers.
- Building branded title sequences with specific colors and lighting.
- Producing animated lower thirds with 3D depth.

## Tips
- The plan includes camera position and movement, lighting (ambient, directional, point lights), and optional particle systems.
- Duration is capped at 60 seconds. For longer title sequences, consider splitting into multiple segments.
- Background media (connected via the `background` input) is rendered behind the 3D scene.
- This node uses Claude Sonnet for 3D scene planning, which reflects the complexity of generating camera, lighting, and particle configurations.
- Connect to Render Video downstream to produce the final video file.
