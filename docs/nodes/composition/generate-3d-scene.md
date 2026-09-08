# Generate 3D Scene

Basic remains the default authoring engine. Clients can discover optional
Advanced support through `GET /v1/3d-scene/capabilities`. An unavailable engine
is refused before generation; selecting it does not fall back to Basic.

The Authoring engine control appears when Advanced is available. Basic exposes
the model and reasoning controls; Advanced uses the deployment's fixed planner.
The chosen engine is preserved in revision history and used by both canvas and
headless workflow runs. Advanced requires `SCENE3D_ADVANCED_ENABLED` and an
installed engine; local Blender additionally requires `SCENE3D_LOCAL_ENABLED`.

Create an editable animated clay scene from a prompt, with optional image and video references. Use the preview to inspect framing, camera motion and object blocking before rendering a video.

The output is a **composition plan**, not an MP4. Connect it to [Edit 3D Scene](edit-3d-scene.md) for changes or [Render Video](render-video.md) for export.

## Inputs

| Input | Purpose |
|---|---|
| Prompt | Describe objects, their motion, camera placement/movement and timing. |
| References | Up to 8 total, including at most 1 video. Images guide appearance/layout; video guides motion/layout. |
| Duration | 1–60 seconds; default 4. |
| FPS | 15–60; default 24. |
| Aspect ratio | `16:9` (default), `9:16`, `1:1`, or `4:5`. |
| LLM model | Model used to author the scene plan. |

Reference-based reconstruction is approximate. Images do not recover unseen geometry; a video is interpreted as a movement/layout guide. Inspect the preview before export. The first version uses bounded geometric primitives and groups, including simple character proxies; it does not reconstruct detailed textured meshes or physical simulations.

## Preview and revisions

The scene stores object IDs, transforms, dimensions, camera position/target/lens, lighting and keyframes. The canvas preview supports playback, scrubbing and direct property editing. Direct edits create a new scene revision and do not require an LLM call. Previous generated scenes remain available in result history.

Coordinates use meters with Y pointing up. Euler rotations are radians. Timeline frames start at zero. Each rendered MP4 uses a specific scene revision.

## API and SDK

`POST /v1/3d-scene/generate` returns `{ jobId }`. Poll the job; its completed `output_data.scenePlan` contains the editable scene.

```typescript
const scene = await client.nodes.runAndWait("generate-3d-scene", {
  prompt: "A red suitcase rolls behind a central pillar and reappears. Dolly right over four seconds.",
  durationSeconds: 4,
  fps: 24,
  aspectRatio: "16:9",
  references: [{
    id: "suitcase-appearance",
    kind: "image",
    role: "appearance",
    url: appearanceImageUrl, // an uploaded reference image
  }],
});
const video = await client.nodes.runAndWait("render-video", {
  planType: "3d-scene",
  plan: scene.scenePlan,
});
```

References use `{ id, url, kind, role }`; `kind` is `image` or `video`, and `role` is `appearance`, `layout` or `motion`. An optional `objectId` binds the reference to an object. V1 analyzes the whole reference clip. To use a segment, run `trim-video` first and reference its result; authoring rejects partial `startSeconds` / `endSeconds` windows before charging.

Cloud defaults are **10 credits for economy LLMs, 30 for standard, and 40 for premium**. The default scene authoring model is Claude Sonnet 4.6 (standard). High reasoning effort can raise the billed LLM tier; see [reasoning effort](../ai-text/llm-chat.md#reasoning-effort). A video reference adds the existing [Video Analysis](../processing-video/video-analysis.md) charge. MP4 export adds **15 credits** through Render Video.

The total is **scene authoring + optional video analysis + optional MP4 export**. For example, a standard-model scene using only image references costs 30 credits to author and 45 including one MP4 export. Preview playback and local property edits are free. These are the built-in defaults; the model-cost API supplies the instance's current prices. Community and Business editions do not use Cloud credit billing.

## Using the exported motion guide

Use the rendered MP4 as a video reference on a model that accepts video references. Also connect the original appearance images to that final generation node; the clay render supplies blocking and camera motion, while those images supply the desired appearance. To compare guided and unguided results, keep the prompt, appearance images, model and generation settings identical; add only the clay video and the instruction identifying it as the motion/layout guide.

Both nodes support [prompt pre/post text](../../prompt-pre-post-text.md). The canvas applies those affixes when it submits the instruction.
