# Motion Graphics
> AI-generated 2D motion graphics including lower thirds, title cards, kinetic typography, and animated shapes.

## Overview
The Motion Graphics node uses Claude Sonnet to generate a plan for 2D motion graphics compositions. It supports lower thirds, title cards, kinetic typography, animated shapes, and SVG path animations. Rendering uses pure Remotion primitives with a built-in `FONT_MAP`. A live preview is available in the config panel. Maximum duration is 60 seconds.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Motion Graphics Prompt | string | `""` | Natural language description of the desired motion graphics. An info guide is available in the UI for prompt tips. |
| FPS | number | `30` | Frames per second. Options: `24`, `30`, `60`. |
| Duration | number (seconds) | `5` | Duration of the output. Range: 1--60 seconds (hard maximum). |
| Aspect Ratio | enum | `"16:9"` | Output aspect ratio. Options: `16:9`, `9:16`, `1:1`, `4:5`. |
| Background Color | hex string | `"#00000000"` | Background color. Supports alpha channel for transparency (8-digit hex). Default is fully transparent. |

## Inputs & Outputs

**Inputs:**
- `in` -- Optional input for context or reference data.

**Outputs:**
- `composition` -- Motion graphics plan (JSON). Connect to a Render Video node for final output.

## Credit Cost
10 credits per generation (Claude Sonnet AI call).

## Best Practices
- Use the info guide in the prompt field for tips on what the AI can generate.
- Specify colors, fonts, and animation styles explicitly for consistent branding.
- Use transparent backgrounds (`#00000000`) when layering motion graphics over other video content.
- Keep duration under 15 seconds for lower thirds and title cards; use longer durations for kinetic typography sequences.

## Common Use Cases
- Creating animated lower thirds for interviews or presentations.
- Building kinetic typography sequences from quotes or lyrics.
- Designing animated title cards with branded colors and fonts.
- Producing shape and SVG path animations for explainer content.
- Generating transparent motion graphic overlays for compositing.

## Tips
- The default background is fully transparent (`#00000000`), making it ideal for overlaying on other video.
- The `FONT_MAP` provides a curated set of fonts. Describe the desired font style in your prompt (e.g., "modern sans-serif" or "elegant serif").
- Duration is capped at 60 seconds. For longer motion graphic sequences, chain multiple nodes.
- Preview is always available in the config panel (unlike After Effects, which requires a source video).
- For precise text content, include the exact text in your prompt rather than relying on the AI to generate copy.
