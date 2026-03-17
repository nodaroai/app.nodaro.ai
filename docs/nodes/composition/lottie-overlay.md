# Lottie Overlay
> AI-placed timed Lottie animations overlaid on video.

## Overview
The Lottie Overlay node uses Claude Sonnet to interpret a prompt and select, position, and time Lottie animations from a built-in library. The AI determines which animations to use, where to place them on screen, and when they should appear and disappear. The result is rendered using `@remotion/lottie` with `delayRender`/`continueRender` for each overlay.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Overlay Prompt | string | `""` | Natural language description of desired overlay animations and their placement. |
| FPS | number | `30` | Frames per second. Options: `24`, `30`, `60`. |
| Duration | number (seconds) | `10` | Duration of the output. Range: 1--300 seconds. |

## Inputs & Outputs

**Inputs:**
- `in` -- Source video to overlay animations onto.
- `lottie` -- Optional Lottie asset input.

**Outputs:**
- `composition` -- Overlay plan (JSON). Connect to a Render Video node for final output.
## Best Practices
- Be specific about where overlays should appear (e.g., "confetti falling from the top during the first 3 seconds").
- Reference timing relative to your video content to ensure overlays align with key moments.
- Keep the duration consistent with the source video.
- Use this node for decorative or informational overlays, not for text-heavy content (use Motion Graphics for that).

## Common Use Cases
- Adding celebration animations (confetti, sparkles, fireworks) to highlight moments.
- Overlaying animated icons or indicators at specific timestamps.
- Enhancing social media videos with eye-catching animated elements.
- Adding animated transitions or accent elements to presentations.

## Tips
- The AI selects from a built-in Lottie animation library. You do not need to provide Lottie files manually unless you want custom animations.
- Each overlay instance uses `delayRender`/`continueRender` to ensure proper loading before rendering.
- The output is a plan -- connect to Render Video to produce the final composited video.
- For best results, describe both the visual effect and the timing (e.g., "arrow pointing down at 0:05 for 2 seconds in the bottom-right corner").
