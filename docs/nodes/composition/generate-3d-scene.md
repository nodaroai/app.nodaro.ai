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
| Input assets | Optional `inputAssets`: up to 8 GLBs selected as `{id, revisionId, assetId, label?}`. Requires an advanced engine with import support. |
| Duration | 1–60 seconds; default 4. |
| FPS | 15–60; default 24. |
| Aspect ratio | `16:9` (default), `9:16`, `1:1`, or `4:5`. |
| LLM model | Model used to author the scene plan. |

Reference-based reconstruction is approximate. Images do not recover unseen geometry; a video is interpreted as a movement/layout guide. Inspect the preview before export. The first version uses bounded geometric primitives and groups, including simple character proxies; it does not reconstruct detailed textured meshes or physical simulations.

## Preview and revisions

The scene stores object IDs, transforms, dimensions, camera position/target/lens, lighting and keyframes. The canvas preview supports playback, scrubbing and direct property editing. Direct edits create a new scene revision and do not require an LLM call. Previous generated scenes remain available in result history.

Coordinates use meters with Y pointing up. Euler rotations are radians. Timeline frames start at zero. Each rendered MP4 uses a specific scene revision.

Deleting your account removes retained scene metadata and schedules its private
files, including abandoned uploads, for cleanup.

## API and SDK

For existing GLBs, send `inputAssets` alongside your prompt and image/video
references. `id` is a unique name within the input list; `revisionId` and
`assetId` identify an authorized retained scene artifact. The server resolves
its digest and byte length. URLs, caller-supplied receipts, and duplicate IDs
are refused. Basic does not accept imported geometry. Import support is
optional and is rejected before pricing when unavailable; selecting Advanced
alone does not guarantee import support. Existing-scene edits retain their
construction inputs; new asset selections belong to new-scene requests.

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

Cloud defaults are **10 credits for economy LLMs, 30 for standard, and 40 for premium**. The default scene authoring model is Claude Sonnet 4.6 (standard). High reasoning effort can raise the billed LLM tier; see [reasoning effort](../ai-text/llm-chat.md#reasoning-effort). A video reference adds the existing [Video Analysis](../processing-video/video-analysis.md) charge. MP4 export adds **50 credits** through Render Video for a scene up to 1920 px on its longest side, **75** above that up to 5.12 megapixels, and **125** for a larger frame — see [what a 3D scene render costs](render-video.md#what-a-3d-scene-render-costs).

The total is **scene authoring + optional video analysis + optional MP4 export**. For example, a standard-model scene using only image references costs 30 credits to author and 80 including one MP4 export. Every aspect ratio this node offers renders at 1920 px or less on its longest side, so its exports are always at the base render price; a larger frame only arises when a scene plan is resized in the editor or supplied through the API or MCP, and it is the export that costs more, never the authoring. Preview playback and local property edits are free. These are the built-in defaults; the model-cost API supplies the instance's current prices. Community and Business editions do not use Cloud credit billing.

## Using the result as a video reference

Scene3D v2 revisions record their clay lighting preset. `clay-studio-v2` adds ground and object shadows with the same lighting in interactive previews and MP4 exports. `clay-studio-v1` retains its original appearance; Basic scenes are unchanged. The scene's authoring engine selects the preset when it creates a revision, so an older saved revision is not silently upgraded.

The MP4 that [Render Video](render-video.md) exports from this scene is a **layout reference** for a video model that accepts video references: it carries where the subjects are, what is in front of what, the framing, the camera move and the timing. It also carries a look — untextured grey clay — and a video model copies that look unless told not to. Two rules keep the layout and drop the clay:

**1. Never attach the clay render without a scoping line.** One sentence per reference, naming what it is *for* and what to *ignore*. Wire the Render Video output into a video node's **Video references** input and the platform adds the line for that reference itself — on a workflow run, on the video node's own Run button, and in the node's **Final** prompt preview, which shows the line exactly as it is sent. Through the API, pass it as the reference's caption — `referenceVideoCaptions[N]` for the clip on `referenceVideoUrls[N]`. The line the platform sends for a clip is:

> LAYOUT reference only — match its subject positions and blocking, its foreground occlusion, its framing, its camera angle, its camera motion and its timing. Ignore its untextured grey clay placeholder look, its flat placeholder colours, its materials, its lighting and its empty background; none of that is the target look. Take the look from the prompt and from the other references

The model reads it as `@video_1: <that line>.` A Basic scene whose camera does not move gets the line without the camera-motion clause; a frame extracted from the render and wired as an image reference gets it without the motion and timing clauses. A prompt that already carries a scoping line for that reference is left alone, so re-running never doubles it.

**2. Every figure that must look real needs its own character reference.** Photoreal treatment is granted per referenced subject, not globally: with one layout reference and one Character, only that character converts and every other figure reverts to a clay proxy. With one Character per figure, every figure converts and every identity holds. Keep two reference slots free for a location or style plate. Basic scenes have no entity roles, so the platform cannot count their figures for you; [3D Render Pro](pro-3d-render.md) compositions do, and a workflow run records a `scene3d_unreferenced_figures` warning on the job when figures outnumber character references.

Also connect the original appearance images to that final generation node: the clay render supplies blocking and camera motion, while those images supply the desired appearance. To compare guided and unguided results, keep the prompt, appearance images, model and generation settings identical; add only the clay video with its scoping line. Wire the render into the reference input, never the start-frame slot — a start frame is a look anchor that no scoping line reaches.

Both nodes support [prompt pre/post text](../../prompt-pre-post-text.md). The canvas applies those affixes when it submits the instruction.
