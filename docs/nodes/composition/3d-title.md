# 3D Title
> AI-generated animated 3D text scenes with camera, lighting, and particle effects.

## Overview
The 3D Title node uses Claude Sonnet (configurable via the model selector — any of the shared LLM registry's models) to generate a plan for animated 3D text scenes. The plan includes camera movements, lighting setups, and optional particle effects. Rendering uses `@remotion/three` with Three.js and `@react-three/drei` for high-quality 3D text animation. Maximum duration is 60 seconds.

Reasoning-capable models additionally show an **Effort** selector next to the model picker (Auto by default — the vendor default, no charge change). `xhigh`/`max` bill one tier up, same rule as every other LLM-backed node — see the Generate Text node's [Reasoning effort](../ai-text/llm-chat.md#reasoning-effort) section for the exact formula and worked examples.

**Advanced mode.** Gemini models offer an **Advanced mode** switch. Turning it on runs the model on the provider's own API instead of through our aggregator, which is the only place `Temperature`, `Max Tokens` and the full reasoning-depth range actually take effect — those controls appear once it is on. It bills **one credit tier up**, and the node's cost badge updates immediately so you can see the change before running. On a non-Gemini model the switch is visible but disabled, with the reason shown inline.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Title Prompt | string | `""` | Natural language description of the desired 3D title animation. |
| FPS | number | `30` | Frames per second. Options: `24`, `30`, `60`. |
| Duration | number (seconds) | `10` | Duration of the output. Range: 1--60 seconds (hard maximum). |
| Aspect Ratio | enum | `"16:9"` | Output aspect ratio. Options: `16:9`, `9:16`, `1:1`, `4:5`. |
| Background Color | hex string | `"#000000"` | Scene background color. |
| `promptPrefix` / `promptSuffix` | text | -- | Optional pre/post text wrapped around the prompt at run time (settings panel → **Pre & post text**; hidden from app users; captured by presets). See [Prompt pre & post text](../../prompt-pre-post-text.md). |

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
