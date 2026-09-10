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
| `video` | The exported MP4, the platform's standard video result. Connect it to any node that consumes a video. |

Wire a downstream video consumer from **`video`**, not from `composition`: the
composition handle carries a plan, not a URL.

The completed job's `output_data` carries:

| Field | Meaning |
|---|---|
| `videoUrl` | The exported MP4 — the platform's standard video result field. |
| `scenePlan` | The exact composition it was rendered from. |
| `sceneRevisionId` | That revision's id, for a later render-only re-run. |
| `posterAssetId` | Preview poster for the result. |
| `sourceArtifactId` | Present when an editable native source was retained. |
| `validation` | `{ status, reportAssetId, warnings[] }` — each warning has a `code`, a `message` and an optional `shotId`. |
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
output into a video node's **Video references** input and a **workflow run**
adds the line for that reference itself (the video node's own Run button does
not add it yet — type it into the prompt there); through the API, pass it as
the reference's caption — `referenceVideoCaptions[N]` for the clip on
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
the job, not the submission.

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

Re-rendering a stored `scenePlan` — through [Render Video](render-video.md), or
through a `{kind:"scene"}` source here — is billed as an ordinary render. You do
not pay to author it again.

Community and Business editions do not use Cloud credit billing and do not
offer this node.

## MCP

The `pro_3d_render` tool exposes the same operation to agents, and is listed
only where the deployment can serve it. See [3D scenes over MCP](../../mcp/3d-scenes.md).
