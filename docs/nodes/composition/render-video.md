# Render Video
> Finalize and render composition plans into video files.

## Overview
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

A completed 3D scene render includes `videoUrl`, `thumbnailUrl`, `sceneRevisionId` and `renderer: "scene3d/three"` in the job output. Reference image/video URLs remain attached to the editable scene but are not downloaded or rendered as scene textures. The built-in Cloud export price is **15 credits**; use the model-cost API for the instance's current price.
