# After Effects
> AI-generated post-processing effects applied to video using Claude Sonnet.

## Overview
The After Effects node uses Claude Sonnet to interpret a natural language prompt and generate a structured effect plan. The plan specifies post-processing effects such as color grading, vignette, film grain, noise, letterboxing, animated blur, trail, and motion blur. A live preview is available in the config panel before rendering.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Effect Prompt | string | `""` | Natural language description of desired post-processing effects. |
| FPS | number | `30` | Frames per second. Options: `24`, `30`, `60`. |
| Duration | number (seconds) | `10` | Duration of the output. Range: 1--300 seconds. |

## Inputs & Outputs

**Inputs:**
- `in` -- Source video to apply effects to.

**Outputs:**
- `composition` -- Effect plan (JSON). Connect to a Render Video node for final output.

## Credit Cost
10 credits per generation (Claude Sonnet AI call).

## Best Practices
- Describe effects in plain language (e.g., "cinematic color grade with warm tones and subtle vignette").
- Use the config panel preview to verify the effect plan before rendering.
- Combine multiple effects in a single prompt rather than chaining multiple After Effects nodes.
- Keep the duration aligned with your source video length to avoid blank frames.

## Common Use Cases
- Applying cinematic color grading to raw video footage.
- Adding film grain and vignette for a vintage look.
- Creating letterboxed widescreen presentations.
- Applying animated blur or motion-blur effects for stylistic emphasis.
- Adding trail effects to create ghosting or echo visuals.

## Tips
- Available effects: color grade, vignette, grain, noise, letterbox, animated-blur, trail, motion-blur.
- Motion blur uses CSS `filter:blur()` and trail effects use `OffthreadVideo` ghost layers in Remotion.
- The preview in the config panel shows the effect applied to the source video. It appears automatically when a source video is connected.
- The output is a plan that must be rendered through the Render Video node.
