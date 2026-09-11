# 3D Render Pro

Author an animated 3D scene from a prompt **and export it**, in one durable
operation. A single job settles with both halves of the result: the exact
composition and the rendered MP4.

This is a different node from [Generate 3D Scene](generate-3d-scene.md), not a
setting on it. Generate 3D Scene is a cheap, editable clay previz pass whose
MP4 comes from a separate [Render Video](render-video.md) run; 3D Render Pro
produces a finished shot in one go, on a hosted build engine.

## Availability

3D Render Pro exists only on deployments whose installed authoring engine
implements it. Check before you offer it:

```typescript
const caps = await client.scene3d.capabilities();
if (caps.pro?.available) {
  // the node is servable here
}
```

`GET /v1/nodes` omits the type entirely where it is unavailable, and the editor
does not show it in the Add Node picker. A request sent anyway is refused with
`503 SCENE_CAPABILITY_UNAVAILABLE` — it never falls back to the Basic lane.

Workflows that already contain the node keep rendering their stored
composition and their stored video if the engine is later switched off. Only
new runs are refused.

## The source

Every run names exactly one **source**, and the choice is what decides both
the pipeline and the price.

| Source | Shape | What happens |
|---|---|---|
| New scene | `{ kind: "prompt", prompt, references?, inputAssets? }` | Authors a scene from your brief, then renders it. |
| Existing scene | `{ kind: "scene", revisionId, sourceJobId }` | **Render-only.** Exports that exact revision. No authoring or build charge. |
| Existing scene, revised | `{ kind: "scene", revisionId, sourceJobId, editPrompt }` | Revises the scene first, then renders it. |
| Desktop export | `{ kind: "local-export", exportId, connectionId }` | Uses a completed export from a paired desktop Blender, where that is available. |

`editPrompt` is what separates a render-only export from a paid revision, so
**omit the field** when you want a plain export. Sending an empty string is a
different request and is treated as one.

`sourceJobId` is required for Basic scenes retained only in job history. It is
optional for retained revisions, including manual edits. The platform checks
current scene permissions for retained revisions and job ownership for Basic
job-history sources; knowing either identifier does not grant access.

`inputAssets` selects existing GLBs by `{id, revisionId, assetId, label?}`;
it is separate from image/video `references` and uses the same limits as
[Generate 3D Scene](generate-3d-scene.md). It requires engine import support.
The quote and run must carry identical selectors. The server rechecks current
permissions and immutable byte receipts before admitting the quoted run.
Existing-scene and desktop-export sources do not accept new input selectors.

On the canvas, pick the source in the node's panel and wire the scene into the
node's **Scene** input.

## Inputs

| Input | Purpose |
|---|---|
| Scene | An existing composition from another 3D node (canvas `scene` handle). |
| References | Up to 8 total, including at most 1 video. Images guide appearance/layout; video guides motion/layout. New-scene source only. |
| Duration | 1–60 seconds; default 10. |
| FPS | 15–60; default 24. |
| Aspect ratio | `16:9` (default), `9:16`, `1:1`, `4:5` or `21:9`. |
| Style | `clay` (default). |
| Quality | The profiles this deployment advertises; `standard` today. |
| Correction budget | 0–2 repair passes after the first attempt; default 2. Each pass is paid work, which is why it is shown. |
| Engine | `blender-cloud` (default) or `blender-local` where a paired desktop is available. An unknown or unavailable engine is rejected rather than downgraded. |

There is **no model or reasoning-effort field**. The planner is fixed and
server-owned, so there is nothing here to pick.

**Timing on an existing scene.** A scene already has its own duration, fps and
aspect ratio. Omit those fields to keep them; sending them is an explicit
re-time request, and an incompatible one is rejected rather than silently
applied.

## Outputs

| Handle | Value |
|---|---|
| `composition` | The scene revision this run produced — the same kind of plan the Basic 3D nodes emit. Connect it to [Render Video](render-video.md), or to another 3D node's Scene input, to re-export without paying to author again. |
| `stills` | One still image per shot of the composition, in shot order — each is the frame that shot opens on. Connect it to any node that consumes images; the whole set travels down the wire, not just the first. |
| `video` | The exported MP4, the platform's standard video result. Connect it to any node that consumes a video. |

Wire a downstream video consumer from **`video`**, not from `composition`: the
composition handle carries a plan, not a URL.

**The stills are a contact sheet, not a second render.** They come out of the
same run at no extra credit cost, and a v1 (single-shot) scene produces exactly
one, at frame 0. Use them to feed a shot's opening frame into an image or video
model as a reference, or to review the blocking shot by shot without scrubbing
the MP4. A result produced before this existed simply has none.

**Wiring a still into any image input just works.** Their bytes stay in the
private scene bucket, so the `url` you read back is authenticated rather than a
public link — but you do not have to solve that to use one. Connect the `stills`
handle to a node's image or reference-image input and, for that run only, the
platform grants the model a short-lived, single-artifact read of the exact still
it needs; the grant expires minutes later and is never stored. The stored
result keeps the authenticated URL, which is the one still meaningful tomorrow.

The grant is issued against **your own** access, at the moment the run is
dispatched: a still from a delivery you can no longer read is not sent, and no
link that outlives the run is created anywhere.

The completed job's `output_data` carries the fields below. A job that failed
with `SCENE_QUALITY_FAILED` carries a smaller set of the same fields, pointing
at the draft it kept — see [Errors](#errors).

| Field | Meaning |
|---|---|
| `videoUrl` | The exported MP4 — the platform's standard video result field. |
| `scenePlan` | The exact composition it was rendered from. |
| `sceneRevisionId` | That revision's id, for a later render-only re-run. |
| `posterAssetId` | Preview poster for the result. |
| `shotStills` | One entry per shot, ordered by `shotIndex`: `{ shotIndex, frame, assetId, url }`. `shotIndex` is 0-based in the composition's shot order and `frame` is the shot's own first frame in the composition's frame space, so a still lines up against the MP4 without re-deriving shot boundaries. Each `url` is an authenticated delivery endpoint, not a public link — the editor reads it with your session, and a run that wires a still into a model is granted its own short-lived read (see Outputs above). Absent on a result that rendered none. |
| `sourceArtifactId` | Present when an editable native source was retained. |
| `validation` | `{ status, reportAssetId, warnings[] }` — each warning has a `code`, a `message` and an optional `shotId`. `status` is `passed` here; a **failed** job can carry this field too, with `status: "failed"` (see [Errors](#errors)). |
| `renderer` | Renderer identity/version the export was produced with. |
| `metadata` | `{ width, height, fps, frames, duration }` — check these against a downstream model's video-reference limits before wiring the MP4 in. |

## Using the result as a video reference

The exported MP4 is a **layout reference**: it carries where the subjects
are, what is in front of what, the framing, the camera move and the timing.
It also carries a look — untextured grey clay — and a video model copies that
look unless it is told not to. Two rules, both measured on a real scene, keep
the layout and drop the clay:

**1. Never attach the clay render without a scoping line.** One sentence per
reference, naming what it is *for* and what to *ignore*. Wire the `video`
output into a video node's **Video references** input and the platform adds the
line for that reference itself — on a workflow run, on the video node's own Run
button, and in the node's **Final** prompt preview, which shows the line exactly
as it is sent. Through the API, pass it as the reference's caption — `referenceVideoCaptions[N]` for the clip on
`referenceVideoUrls[N]`. The line the platform sends for a clip is:

> LAYOUT reference only — match its subject positions and blocking, its foreground occlusion, its framing, its camera angle, its camera motion and its timing. Ignore its untextured grey clay placeholder look, its flat placeholder colours, its materials, its lighting and its empty background; none of that is the target look. Take the look from the prompt and from the other references

The model reads it as `@video_1: <that line>.` — the same seat every video
caption renders to. A composition with several shots adds their cut points to
the "match" clause; a frame extracted from the render and wired as an image
reference gets the same line without the motion and timing clauses. A prompt
that already carries a scoping line for that reference is left alone, so
re-running never doubles it.

**2. Every figure that must look real needs its own character reference.**
Photoreal treatment is granted per referenced subject, not globally: with one
layout reference and one Character, only that character converts and every
other figure reverts to a clay proxy. With one Character per figure, every
figure converts and every identity holds. Keep two reference slots free for a
location or style plate. A workflow run whose composition has more `person`
entities than character references still runs — you may want clay figures —
and records a `scene3d_unreferenced_figures` warning on the job
(`input_data.warnings`, `{ code, message }`) saying how many figures are
uncovered and whether one-per-figure fits the model's reference budget.

Wire the render into the **reference** input, never the start-frame slot: a
start frame is a look anchor that no scoping line reaches.

## Quote, then run

Two endpoints, one paid job.

`POST /v1/pro-3d-render/quote` takes the request **without** a `quoteId` and
answers a ceiling you can show before anyone commits:

```json
{
  "quoteId": "...",
  "expiresAt": "2026-09-08T01:00:00.000Z",
  "maxCredits": 900,
  "breakdown": [{ "code": "authoring", "label": "Authoring", "credits": 600 }],
  "pricingVersion": "...",
  "capabilitiesVersion": "...",
  "normalizedInputHash": "..."
}
```

Quoting reserves nothing and spends nothing. `maxCredits` is a **ceiling**, not
a charge.

`POST /v1/pro-3d-render` then takes the same body plus that `quoteId` and an
`Idempotency-Key` header (8–255 characters), and returns `{ jobId }`. Admission
re-checks the quote against the request, so a body edited between the two calls
is refused rather than run at a price it was never quoted for. An expired or
stale quote is refused before anything is reserved — request a new one.

Reuse the same `Idempotency-Key` when retrying a submit that timed out, so one
intent cannot become two paid runs.

## API and SDK

```typescript
const caps = await client.scene3d.capabilities();
if (!caps.pro?.available) return; // this deployment cannot serve it

// Author a new scene and export it — quotes and runs in one call.
const shot = await client.scene3d.renderProAndWait({
  source: {
    kind: "prompt",
    prompt: "A red suitcase rolls behind a central pillar and reappears. Dolly right over thirty seconds.",
    references: [{ id: "look", kind: "image", role: "appearance", url: appearanceImageUrl }],
  },
  durationSeconds: 30,
  fps: 24,
  aspectRatio: "21:9",
  maxRepairPasses: 2,
});

shot.videoUrl;         // the exported MP4
shot.scenePlan;        // the exact composition it was rendered from
shot.sceneRevisionId;  // that revision's id

// Later: export the SAME revision again. Render-only — no authoring charge.
await client.scene3d.renderProAndWait({
  source: { kind: "scene", revisionId: shot.sceneRevisionId, sourceJobId: shotJobId },
});
```

Show the ceiling first by quoting explicitly:

```typescript
const quote = await client.scene3d.quotePro(params);
// ...show quote.maxCredits and quote.breakdown...
await client.scene3d.runPro({ ...params, quoteId: quote.quoteId });
```

`client.nodes.run("pro-3d-render", params)` and
`client.nodes.runAndWait("pro-3d-render", params)` reach the same routes with
the same types; both require the `quoteId`.

References use `{ id, url, kind, role }` exactly as the Basic authoring nodes
do; `kind` is `image` or `video`, `role` is `appearance`, `layout` or `motion`.
The whole reference clip is analyzed — trim a segment first with `trim-video`
if you need part of one.

Pass `acceptedSceneSchemaVersions` to declare which scene-schema versions your
client can render. 3D Render Pro produces version 2; a client that does not
accept it is refused before the build rather than handed a manifest it cannot
open.

### Errors

| Status / code | Meaning |
|---|---|
| `503 SCENE_CAPABILITY_UNAVAILABLE` | This deployment has no engine that implements the operation, or the requested engine / local execution is unavailable here. |
| `503 price_not_configured` | The operator has not configured a credit price for `pro-3d-render`. Nothing was reserved. |
| `400 validation_error` | Body, source shape, engine value, correction budget, reference list, accepted-schema mismatch, missing `quoteId`, or a missing/out-of-bounds `Idempotency-Key`. |

Runtime failures use the scene error codes (`SCENE_RESOURCE_LIMIT`,
`SCENE_EXPORT_UNSUPPORTED`, `SCENE_QUALITY_FAILED`, `SCENE_REVISION_CONFLICT`,
`SCENE_BUILD_TIMEOUT`, `SCENE_RENDER_FAILED`, and the local-executor codes) on
the job, not the submission. The job's error message starts with the code.

The planning stage adds three codes of its own. Two are worth retrying as-is;
the third is not:

| Code | Retry? | Meaning |
|---|---|---|
| `SCENE_PROVIDER_UNAVAILABLE` | Yes, after a few minutes | The scene planner's model provider was unavailable, overloaded or rate-limited, or the call never received an answer. The brief was not the problem. |
| `SCENE_PLANNING_TIMEOUT` | Yes | Planning ran past its time bound. Retry, or shorten the brief and reference set. |
| `SCENE_PLANNER_OUTPUT_INVALID` | No, not unchanged | The provider answered, but the recipe it produced could not be accepted by the compiler. Simplify the brief or use fewer references. |

Work already completed before the failure (an earlier repair pass, for
example) is charged as usual; the message never promises a refund it cannot
verify.

#### `SCENE_QUALITY_FAILED` keeps the scene it built

`SCENE_QUALITY_FAILED` means the visual reviewer still found a blocking problem
after the last correction pass the budget allowed. The job **fails** — there is
no MP4, and `videoUrl`/`resultUrl` are absent rather than empty — but the scene
it built is kept, and the failed job's `output_data` says where:

| Field | Meaning |
|---|---|
| `sceneRevisionId` | The draft revision. A real, readable scene: `GET /v1/3d-scene/revisions/{revisionId}` returns its manifest. |
| `deliveryId` | `GET /v1/3d-scene/deliveries/{jobId}` lists its retained evidence, exactly as it does for a delivered scene. |
| `posterAssetId` | A rendered frame of the draft, read from the delivery's assets route. |
| `validation` | `{ status: "failed", scope: "authored", reportAssetId, passes, warnings[] }` — `passes` is how many authoring passes were spent, and each warning carries a `code`, a `message` and, where the finding cites frames inside one shot, that `shotId`. |
| `scenePlan`, `renderer`, `metadata` | The draft composition and its frame size, fps and duration. |

The `reportAssetId` artifact is the reviewer's full account: every finding, its
category and severity, the frames it cites and the correction it asked for.
Read it from the delivery assets route.

Nothing about a kept draft claims it passed. `validation.status` is `failed`
on the job, and the report says `failed` too.

**What you can do with it:**

- **Render it as-is.** Submit it as a scene source with no edit instruction —
  an ordinary render-only run. It re-runs no authoring and no build, and pays
  only for the render and export. That run is a normal completed job, and its
  own `validation` describes the checks a render-only export performs (it says
  so: `scope: "render-only"`, plus a warning that no new visual review was
  done). It does not re-judge, or overturn, the authored quality verdict.
- **Fix it yourself.** Deterministic edits — transform, colour, visibility,
  shot offsets — apply to the draft like any other retained scene and cost no
  authoring credits. Each edit produces a new revision whose provenance names
  the draft it came from.
- **Re-author from it.** Submit it as a scene source **with** an edit
  instruction to pay for another authoring pass from the draft's own recipe.

Retaining costs nothing: no extra render, no extra provider call, and the
settlement is the same one the run would have had.

**When nothing could be built at all.** If the compiler refused the recipe on
every pass, there is no scene to keep: no revision, no poster, and no
`sceneRevisionId` — a composition needs geometry and shots, and none was ever
produced. What the run *does* have is the planner's final recipe and the
compiler's reasons for refusing it, and those are kept. `deliveryId` still
resolves: `GET /v1/3d-scene/deliveries/{jobId}` answers for the owner with
`sourceKind: "refused-authoring"` and `sceneRevisionId: null`, and
`output_data.validation` is `{ status: "failed", scope: "authored", phase,
reportAssetId, passes, warnings[] }`, where `phase` says which stage kept
refusing — `build` when the compiler would not build the recipe, `planning`
when its grammar would not admit one. Each warning is one refusal, naming the
path in the recipe it pointed at where it gave one. The
report artifact holds the full set, refusal by refusal. The recipe is retained
for re-authoring rather than offered as a download. A job that failed before
any of that — the planner itself refused, or was never reached — has nothing
to keep, and its `output_data` carries none of these fields.

The scene instruction supports [prompt pre/post text](../../prompt-pre-post-text.md), applied by the canvas when it submits the instruction.

## Credits

3D Render Pro is a single billable operation. What it covers depends on the
source: a new scene pays for authoring, the hosted build and the render; an
existing scene with **no** edit instruction is render-only and pays for neither
authoring nor the build. Each repair pass inside the correction budget is paid
work, which is why the budget is a visible control.

Its price is **deployment configuration**: there is no built-in default, so the
quote endpoint is the authority for any given request, and an install with no
configured price refuses before reserving anything. Quote first and show
`maxCredits` — a ceiling, not a charge.

### Frame size

The render stage is priced **per output frame**, so a longer scene and a higher
frame rate both cost more, in proportion to the frames they produce. The
per-frame rate is tiered by frame size on the same ladder as
[Render Video](render-video.md#what-a-3d-scene-render-costs): frames up to
1920 px on the longest side at the base rate, **1.5x** above that up to 5.12
megapixels, **2.5x** for a larger frame. A frame at or under 1920 px on its
longest side is always base-rate, whatever its shape — raising the frame cap
cannot make a scene you already render more expensive.

The higher rates are derived from your install's own configured base per-frame
price, not set separately, so re-pricing the base moves the whole ladder.

That tier reaches your quote only once the deployment's render engine reports
it in `breakdown` — read the quote you were given rather than computing one, in
every case.

Re-rendering a stored `scenePlan` — through [Render Video](render-video.md), or
through a `{kind:"scene"}` source here — is billed as an ordinary render. You do
not pay to author it again.

Community and Business editions do not use Cloud credit billing and do not
offer this node.

## MCP

The `pro_3d_render` tool exposes the same operation to agents, and is listed
only where the deployment can serve it. See [3D scenes over MCP](../../mcp/3d-scenes.md).
