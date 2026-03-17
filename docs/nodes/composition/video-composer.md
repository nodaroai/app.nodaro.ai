# Video Composer
> AI-powered scene-graph video composition from natural language prompts.

## Overview
The Video Composer node uses Claude Sonnet to transform a text prompt into a structured scene-graph plan. It analyzes connected upstream assets (images, videos, audio) and arranges them into a multi-track timeline composition. The resulting plan is then rendered into a final video via the Render Video node.

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
