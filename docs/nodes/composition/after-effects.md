# After Effects
> AI-generated post-processing effects applied to video using Claude Sonnet.

## Overview
The After Effects node uses Claude Sonnet (configurable via the model selector — any of the shared LLM registry's models) to interpret a natural language prompt and generate a structured effect plan. The plan specifies post-processing effects such as color grading, vignette, film grain, noise, letterboxing, animated blur, trail, and motion blur. A live preview is available in the config panel before rendering.

Reasoning-capable models additionally show an **Effort** selector next to the model picker (Auto by default — the vendor default). Effort has no price of its own: the call is charged for the tokens it uses at the model's rate, so a higher effort costs more only through the reasoning it writes — see the Generate Text node's [Credit pricing](../ai-text/llm-chat.md#credit-pricing).

**Advanced mode.** Gemini and Claude models offer an **Advanced mode** switch. Turning it on runs the model on the provider's own API instead of through our aggregator, which is the only place `Temperature`, `Max Tokens` and the full reasoning-depth range actually take effect — those controls appear once it is on. The call is charged at that lane's per-token rate ([LLM model rates](../../pricing/llm-models.md)), and the node's cost badge updates immediately so you can see the change before running. On any other model the switch is visible but disabled, with the reason shown inline. On a Claude model, choosing any reasoning effort runs the call the same way (Anthropic's API is the only place Claude's effort applies) and is charged the same way.

**Credits.** The effect plan is one LLM call, charged for the tokens it actually used at the selected model's rate on the lane that served it ([LLM model rates](../../pricing/llm-models.md)): the Run button shows an estimate, ≈6 credits<!-- credits: after-effects:claude-sonnet-5.5 --> for a typical plan on the default Claude Sonnet 5.5. A failure the provider billed is charged for that usage; one it did not bill is refunded.

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
