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

When an **advanced** engine authored the scene, `output_data` additionally
reports what that run knows about its own answer. Every field below is optional
and none of them appears on the deterministic Basic lane, which asks no model:

| Field | Meaning |
|---|---|
| `validation.warnings[]` | Advisories about the result, each `{ code, message, shotId? }`. Entries coded `SCENE_AUTHORING_ASSUMPTION` are authoring caveats — the brief did not say, so the run decided — carrying the planner's assumption with any normalization the engine applied. |
| `metadata.summary` | The planner's own one-or-two-sentence description of the scene it authored; on a repaired run, of the repair. A run that returned no summary is not an error. |
| `repairPasses` | Repairs that actually ran, never the authoring-pass count: `0` when the scene was accepted first time. |
| `admissionRetries` | Pre-build planner retries actually spent: a recipe the compiler would not admit is re-asked of the planner, with no build and no repair pass spent. Counted apart from `repairPasses`, never folded into it, and absent when the run needed none. Where the deployment quotes it, the allowance is a separate `admission` line on the quote — `Admission retries (up to 3, planner only)`, a ceiling whose unspent part is released at settlement. See [3D Render Pro](pro-3d-render.md#the-admission-retry-allowance). |
| `mechanicalPasses` | Repairs the engine applied **itself**, from the compiler's own structured remedy, with no planner call. Counted **apart** from `repairPasses` and never folded into it: these passes spend their own quoted allowance — the `mechanical` line, up to 2, released when unspent — rather than one of your repairs, so a run may report more mechanical passes than repairs. The pass identity the pricing keeps is `buildPasses = authoringPasses + repairPasses + mechanicalPasses`. Each one also adds a `REMEDY_AUTO_APPLIED` warning. Optional, and absent both when the run took none and on an engine that does not report it. See [The mechanical-pass allowance](pro-3d-render.md#the-mechanical-pass-allowance). |
| `restoredAssertions` | Mandatory assertions the engine put **back** after a planner answer re-shaped one the feedback had not named — restored to the last admitted recipe's exact form so the run continues instead of refusing over a value the engine already held. Each entry is `{op, path, value?, assertionId, reason}` and also an `ASSERTION_RESTORED` warning. Optional; absent on a run that restored nothing. |
| `metadata.review` | Present **only** on a delivery the visual review did not approve, and `verdict` says which way. `{ verdict: "refused", objections[], observed? }` — a scene that passed every mandatory check, whose review still objected once the repair budget was spent; each objection `{ category, what, correction?, frames[] }` is also a `SCENE_REVIEW_REFUSED` entry in `validation.warnings[]`. `{ verdict: "unavailable", reason, attempts, objections[], observed? }` — the review produced no usable verdict in `attempts` asks (`reason` is `"provider"` when it never reached its provider, `"unusable"` when the provider answered with nothing usable), so **nobody judged the scene**; `validation.warnings[]` leads with a `SCENE_REVIEW_UNAVAILABLE` entry, and any objections under it are review batches that answered usably first rather than a verdict. |

Read them as optional — a result from a deployment without an advanced engine,
or one produced before these existed, simply has none.

**A delivery the review did not approve is still a completed job.** A scene whose
mandatory checks all passed is delivered rather than withheld in two cases: the
repair budget is spent and only the visual review still objects, or the review
gave no usable verdict at all — it never reached its provider, or the provider
answered with nothing usable — and nobody could judge the scene. The job
completes either way and `metadata.review` carries a `verdict` saying which.
`validation.status` stays `passed` there (the mandatory checks *did* pass) and
the objection list may be empty, so test for `metadata.review` itself rather
than for the status or the warning count — and read `verdict` before describing
it, because a message about a refusal on a scene nobody reviewed invents an
opinion that does not exist. See
[3D Render Pro](pro-3d-render.md#when-a-scene-that-passed-is-delivered-unapproved)
for the full shape and what to do with one.

**A FAILED advanced job can still carry a result.** When the repair budget runs
out and a mandatory check has failed, the scene the run built is kept rather than
discarded: the job fails, there is no completed result, and `output_data` points
at what exists — `scenePlan` and `sceneRevisionId` for the draft itself,
`deliveryId` for its retained evidence, `posterAssetId` for a rendered frame of
it, and `validation` with `status: "failed"`. The draft is an ordinary scene
revision: render it, edit it deterministically, or re-author from it.

**On the canvas, by every route.** A refused draft reaches the node the same way
whichever way the run was started, and survives a page reload: the single-node
Run files it live, a full workflow Run carries it on the failed node's
`nodeStates[nodeId].output`, and reopening the workflow re-files it from the job
— together with the failure, which is re-asserted because a node's run status is
not part of the saved workflow. The node shows the draft and the refusal at once;
a scene being present never means the run passed. Whatever the route, the draft
is filed by the same rule a successful revision is: an edit you made while the
run was in flight still wins, and the arriving draft is kept in the node's
revision history rather than overwriting it.

When the compiler refused the recipe on *every* pass there is no draft — nothing
compiled, so there is no `scenePlan` and no `sceneRevisionId`. That result still
has a `deliveryId`, and `validation.sourceRetained` says whether the recipe it
was refused for was kept; when it was, the delivery lists a `source-json`
descriptor you can read with `client.scene3d.retainedRecipe(jobId)`. Reading it
needs edit access to the job's workflow and costs no credits. See
[3D Render Pro](pro-3d-render.md#scene_quality_failed-keeps-the-scene-it-built).

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

Cloud defaults are **11 credits<!-- credits: 3d-scene:economy --> for economy LLMs, 33<!-- credits: 3d-scene --> for standard, and 44<!-- credits: 3d-scene:premium --> for premium**. The default scene authoring model is Claude Sonnet 5.5 (standard). High reasoning effort can raise the billed LLM tier; see [reasoning effort](../ai-text/llm-chat.md#reasoning-effort). A video reference adds the existing [Video Analysis](../processing-video/video-analysis.md) charge. MP4 export adds **55 credits**<!-- credits: render-video --> through Render Video for a scene up to 1920 px on its longest side, **83**<!-- credits: render-video:3d-large --> above that up to 5.12 megapixels, and **138**<!-- credits: render-video:3d-xlarge --> for a larger frame — see [what a 3D scene render costs](render-video.md#what-a-3d-scene-render-costs).

The total is **scene authoring + optional video analysis + optional MP4 export**. For example, a standard-model scene using only image references costs 33 credits<!-- credits: 3d-scene --> to author and 88<!-- credits: 3d-scene + render-video --> including one MP4 export. Every aspect ratio this node offers renders at 1920 px or less on its longest side, so its exports are always at the base render price; a larger frame only arises when a scene plan is resized in the editor or supplied through the API or MCP, and it is the export that costs more, never the authoring. Preview playback and local property edits are free. These are the built-in defaults; the model-cost API supplies the instance's current prices. Community and Business editions do not use Cloud credit billing.

## Using the result as a video reference

Scene3D v2 revisions record their clay lighting preset. `clay-studio-v2` adds ground and object shadows with the same lighting in interactive previews and MP4 exports. `clay-studio-v1` retains its original appearance; Basic scenes are unchanged. The scene's authoring engine selects the preset when it creates a revision, so an older saved revision is not silently upgraded.

The MP4 that [Render Video](render-video.md) exports from this scene is a **layout reference** for a video model that accepts video references: it carries where the subjects are, what is in front of what, the framing, the camera move and the timing. It also carries a look — untextured grey clay — and a video model copies that look unless told not to. Two rules keep the layout and drop the clay:

**1. Never attach the clay render without a scoping line.** One sentence per reference, naming what it is *for* and what to *ignore*. Wire the Render Video output into a video node's **Video references** input and the platform adds the line for that reference itself — on a workflow run, on the video node's own Run button, and in the node's **Final** prompt preview, which shows the line exactly as it is sent. Through the API, pass it as the reference's caption — `referenceVideoCaptions[N]` for the clip on `referenceVideoUrls[N]`. The line the platform sends for a clip is:

> LAYOUT reference only — match its subject positions and blocking, its foreground occlusion, its framing, its camera angle, its camera motion and its timing. Ignore its untextured grey clay placeholder look, its flat placeholder colours, its materials, its lighting and its empty background; none of that is the target look. Take the look from the prompt and from the other references

The model reads it as `@video_1: <that line>.` A Basic scene whose camera does not move gets the line without the camera-motion clause; a frame extracted from the render and wired as an image reference gets it without the motion and timing clauses. A prompt that already carries a scoping line for that reference is left alone, so re-running never doubles it.

**2. Every figure that must look real needs its own character reference.** Photoreal treatment is granted per referenced subject, not globally: with one layout reference and one Character, only that character converts and every other figure reverts to a clay proxy. With one Character per figure, every figure converts and every identity holds. Keep two reference slots free for a location or style plate. Basic scenes have no entity roles, so the platform cannot count their figures for you; [3D Render Pro](pro-3d-render.md) compositions do, and a workflow run records a `scene3d_unreferenced_figures` warning on the job when figures outnumber character references.

Also connect the original appearance images to that final generation node: the clay render supplies blocking and camera motion, while those images supply the desired appearance. To compare guided and unguided results, keep the prompt, appearance images, model and generation settings identical; add only the clay video with its scoping line. Wire the render into the reference input, never the start-frame slot — a start frame is a look anchor that no scoping line reaches.

Both nodes support [prompt pre/post text](../../prompt-pre-post-text.md). The canvas applies those affixes when it submits the instruction.
