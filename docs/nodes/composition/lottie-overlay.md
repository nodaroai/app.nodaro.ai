# Lottie Overlay
> AI-placed timed Lottie animations overlaid on video.

## Overview
The Lottie Overlay node uses Claude Sonnet to interpret a prompt and select, position, and time Lottie animations from a built-in library. The AI determines which animations to use, where to place them on screen, and when they should appear and disappear. The result is rendered using `@remotion/lottie` with `delayRender`/`continueRender` for each overlay.

The built-in animations are self-hosted on the Nodaro CDN (`https://cdn.nodaro.ai/lottie-catalog/<name>.json`) — there is no third-party dependency. Plans authored before the catalog moved to self-hosting (which referenced the old third-party URLs) heal automatically at render time, so saved workflows keep working without any edit.

### Built-in catalog (12 animations)

| Group | Animations |
|-------|------------|
| **Celebration** | Confetti burst, Fireworks, Party popper, Stars sparkle |
| **Social / Reactions** | Heart pulse, Thumbs up, Fire emoji |
| **UI / Indicators** | Loading spinner, Checkmark success, Arrow pointer |
| **Ambient / Decorative** | Floating particles, Glowing ring |

Ambient and continuous effects (stars, heart, fire, spinner, arrow, particles, ring) loop; one-shot effects (confetti, fireworks, party popper, thumbs up, checkmark) play once.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Overlay Prompt | string | `""` | Natural language description of desired overlay animations and their placement. |
| FPS | number | `30` | Frames per second. Options: `24`, `30`, `60`. |
| Duration | number (seconds) | `10` | Duration of the output. Range: 1--300 seconds. |

## Inputs & Outputs

**Inputs:**
- `in` -- Source video to overlay animations onto.
- `lottie` -- Optional Lottie asset input. Connect a **Motion Graphics** node running its **Lottie** engine here: its authored Lottie animation is supplied as a placeable asset (via the Motion Graphics `lottie` output handle), letting you position and time an AI-authored animation over the video instead of relying solely on the built-in catalog.

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
- The AI selects from the built-in, self-hosted Lottie animation library (the catalog above). You do not need to provide Lottie files manually unless you want custom animations.
- Each overlay instance uses `delayRender`/`continueRender` to ensure proper loading before rendering.
- The output is a plan -- connect to Render Video to produce the final composited video.
- For best results, describe both the visual effect and the timing (e.g., "arrow pointing down at 0:05 for 2 seconds in the bottom-right corner").
