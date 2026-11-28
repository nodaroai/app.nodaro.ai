# Video Composer
> AI-powered scene-graph video composition from natural language prompts.

## Overview
The Video Composer node uses Claude Sonnet (configurable via the model selector — any of the shared LLM registry's models) to transform a text prompt into a structured scene-graph plan. It analyzes connected upstream assets (images, videos, audio) and arranges them into a multi-track timeline composition. The resulting plan is then rendered into a final video via the Render Video node.

Reasoning-capable models additionally show an **Effort** selector next to the model picker (Auto by default — the vendor default). Effort has no price of its own: the call is charged for the tokens it uses at the model's rate, so a higher effort costs more only through the reasoning it writes — see the Generate Text node's [Credit pricing](../ai-text/llm-chat.md#credit-pricing).

**Advanced mode.** Gemini and Claude models offer an **Advanced mode** switch. Turning it on runs the model on the provider's own API instead of through our aggregator, which is the only place `Temperature`, `Max Tokens` and the full reasoning-depth range actually take effect — those controls appear once it is on. The call is charged at that lane's per-token rate ([LLM model rates](../../pricing/llm-models.md)), and the node's cost badge updates immediately so you can see the change before running. On any other model the switch is visible but disabled, with the reason shown inline. On a Claude model, choosing any reasoning effort runs the call the same way (Anthropic's API is the only place Claude's effort applies) and is charged the same way.

**Credits.** The scene-graph plan is one LLM call, charged for the tokens it actually used at the selected model's rate on the lane that served it ([LLM model rates](../../pricing/llm-models.md)): the Run button shows an estimate, ≈6 credits<!-- credits: scene-graph-ai:claude-sonnet-5.5 --> for a typical plan on the default Claude Sonnet 5.5. A failure the provider billed is charged for that usage; one it did not bill is refunded.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Composition Prompt | string | `""` | Natural language description of the desired composition. Supports `@node-name` references to upstream assets. |
| Asset Order | string[] | auto | Drag-reorder list of connected upstream assets to control their priority in the composition. |
| Aspect Ratio | enum | `"16:9"` | Output aspect ratio. Options: `16:9`, `9:16`, `1:1`, `4:5`. |
| FPS | number | `30` | Frames per second. Options: `24`, `30`, `60`. |
| Duration | number (seconds) | `30` | Total composition duration. Range: 1--300 seconds. |
| Background Color | hex string | `"#000000"` | Default background color for empty regions. |

## Inputs & Outputs

**Inputs:**
- `in` -- Accepts any upstream media (images, videos, audio). Multiple connections supported.

**Outputs:**
- `composition` -- Scene-graph plan (JSON). Must be connected to a Render Video node for final output.
## Source file

When the video connected to this node is a generation result that kept its original file beside its playable copy (an HDR, 10-bit or HEVC video: see [Video originals and previews](../../design/video-original-and-preview.md)), the node works from that original, not from the copy, and still outputs an 8-bit H.264 MP4. An HDR picture (HLG or PQ) is converted to SDR first, by the same conversion as the result's playable copy, so the output looks like the copy you played; an HDR video you upload is converted the same way. All of a run's conversions together get up to 15 minutes; a video too long to convert in what is left is read as before: the playable copy, or an upload as it is. When a picture was converted, the job's output says so: `output_data.warningCode` is `hdr_tone_mapped`, with an English `warningMessage`. If the original cannot be used (it is gone, it is over the node's download limit, or converting it fails or would take too long), the node works from the playable copy, as before. The price is the same either way.

## Best Practices
- Write descriptive prompts that reference your upstream assets by name using `@node-name` syntax.
- Reorder assets in the Asset Order panel to match their intended visual priority.
- Keep duration reasonable for the number of assets -- overly long compositions with few assets produce sparse timelines.
- Connect to a Render Video node downstream to produce the actual video file.
- Use 16:9 for standard video, 9:16 for vertical/mobile content, 1:1 for social media squares.

## Common Use Cases
- Assembling AI-generated images and narration into a slideshow or explainer video.
- Creating documentary-style compositions from multiple media sources.
- Building social media reels from a collection of clips and images.
- Producing scene-based video from script-generated assets.

## Tips
- The composition prompt is sent to Claude Sonnet, so be specific about timing, transitions, and layering.
- Asset Order affects how the AI prioritizes which media to feature. Drag the most important assets to the top.
- The output is a plan, not a rendered video. Always chain a Render Video node downstream.
- If the AI composition does not match expectations, refine the prompt with more explicit timing cues (e.g., "show image A for 5 seconds, then crossfade to video B").
