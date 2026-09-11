# Render Video
> Finalize and render composition plans into video files.

## Overview

Cancelling a job stops an active Remotion render and closes its browser. A render
timeout also stops the underlying work before cleanup. Deployment interruptions
retain the job's reservation for retry rather than charging again.

The Render Video node takes a composition plan from any upstream composer node (Video Composer, After Effects, Lottie Overlay, 3D Title, Generate 3D Scene, Edit 3D Scene, Motion Graphics, or Composite) and renders it into a final video file using Remotion. It auto-detects the upstream composition type and renders accordingly via a dedicated BullMQ render worker.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Asset Order | string[] | auto | Drag-reorder list of connected assets. Only used when no upstream composer provides a plan. |
| FPS | number | `30` | Frames per second. Options: `24`, `30`, `60`. |
| Duration | number (seconds) | `30` | Duration of the output. Range: 1--120 seconds. |
| Aspect Ratio | enum | `"16:9"` | Output aspect ratio. Options: `16:9`, `9:16`, `1:1`, `4:5`. |
| Background Color | hex string | `"#000000"` | Background color for the rendered video. |

## Inputs & Outputs

**Inputs:**
- `in` -- Composition plan from an upstream composer node, or raw media assets.

**Outputs:**
- `video` -- Rendered video file (MP4).
## Best Practices
- Always connect an upstream composition node (Video Composer, After Effects, etc.) for best results.
- Match FPS and aspect ratio settings with the upstream composer to avoid unexpected scaling or frame rate conversion.
- Keep duration reasonable -- longer videos take proportionally longer to render.
- The render runs on a dedicated BullMQ worker with concurrency of 1, so rendering is sequential.

## Common Use Cases
- Rendering a Video Composer scene-graph plan into a final video.
- Finalizing After Effects post-processing into a deliverable file.
- Producing the final output from any composition workflow.
- Rendering Lottie overlays, 3D titles, or motion graphics into video.

## Tips
- The node auto-detects the plan type from its upstream connection. You do not need to specify which composition type to render.
- The generic `POST /v1/render-video/plan` endpoint accepts a `{ planType, plan }` envelope, meaning any composer node can feed plans to this node.
- Render progress is tracked via `currentJobId` and `currentJobProgress` fields, which update during execution.
- If no upstream composer is connected, the node falls back to arranging raw assets using the Asset Order configuration.
- This is typically the final node in a composition pipeline before output nodes (Save to Storage, social posts, etc.).

## 3D scene compositions

Connect Generate 3D Scene or Edit 3D Scene to render a clay MP4 from the selected revision. The camera, dimensions, frame rate and duration come from the scene plan. Export does not call an LLM or reinterpret the prompt. The API form is `POST /v1/render-video/plan` with `{ planType: "3d-scene", plan: scenePlan }`; the SDK also accepts this through `nodes.run("render-video", …)` and `nodes.runAndWait`. For MCP, use `render_3d_scene`.

A completed 3D scene render includes `videoUrl`, `thumbnailUrl`, `sceneRevisionId` and `renderer: "scene3d/three"` in the job output. Reference image/video URLs remain attached to the editable scene but are not downloaded or rendered as scene textures.

### What a 3D scene render costs

A render's work is per pixel per frame, so its price depends on the frame size
in the scene plan — the plan's own `width` and `height`, not the node's Aspect
Ratio setting. There are three tiers:

| Tier | Frame | Price | Built-in Cloud price |
|---|---|---|---|
| Base | Longest side **1920 px or less**, any shape | The base render price | **50 credits** |
| Large | Longer than 1920 px, up to **5.12 megapixels** | **1.5x** the base | **75 credits** |
| Extra large | Longer than 1920 px, **above 5.12 megapixels** | **2.5x** the base | **125 credits** |

The rule is read in that order. A frame whose longest side is at most 1920 px
is always Base, whatever its area — so a 1920x1920 scene is Base even though it
has the same pixel count as a 2560x1440 one, and every scene that was
renderable before the 2560 px cap costs exactly what it did before. Only past
1920 px does the pixel area choose between Large and Extra large.

Worked examples, at the built-in base price of 50 credits:

| Scene | Pixels | Tier | You pay |
|---|---|---|---|
| 1920x1080 (16:9) | 2.07 MP | Base | 50 credits |
| 1080x1920 (9:16) | 2.07 MP | Base | 50 credits |
| 1920x1920 (1:1) | 3.69 MP | Base | 50 credits |
| 2560x1440 (16:9) | 3.69 MP | Large | 75 credits |
| 1440x2560 (9:16) | 3.69 MP | Large | 75 credits |
| 2048x2560 (4:5) | 5.24 MP | Extra large | 125 credits |
| 2560x2560 (1:1) | 6.55 MP | Extra large | 125 credits |

The tier price is always `ceil(base x multiplier)`, so re-pricing the base
render moves all three together. Every aspect ratio Generate 3D Scene and Edit
3D Scene offer renders at 1920 px or less, so a scene authored on the canvas is
always Base; the larger tiers arise when a plan is resized in the scene editor
or supplied through the API or MCP with its own `width` / `height`. These are the built-in defaults; use the
model-cost API for the instance's current price — the identifiers are
`render-video`, `render-video:3d-large` and `render-video:3d-xlarge`, and the
canvas badge on the node already shows the tier for the plan it is wired to.

Only `3d-scene` plans are tiered. Every other composition — scene graphs,
After Effects, Lottie, 3D titles, motion graphics — keeps the flat render
price at any frame size.
