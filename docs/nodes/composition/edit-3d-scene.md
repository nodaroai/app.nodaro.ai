# Edit 3D Scene

Basic remains the default. Optional Advanced engines are advertised by
`GET /v1/3d-scene/capabilities`; an unavailable explicit engine is rejected
before starting a Basic edit or reserving its credits.

For a connected retained v2 scene, an unset engine selects its available Advanced
engine. An explicit Basic selection is refused. The config panel and headless
workflow use the same choice and preserve the connected revision, locks and edit
instruction. An invalid connected revision fails instead of selecting an older
saved result. Manual retained-scene operations use
`POST /v1/3d-scene/revisions/:revisionId/edits`; the Basic operations below apply
to v1 scenes.

Create a new revision of an existing editable 3D scene. Connect a [Generate 3D Scene](generate-3d-scene.md) or another Edit 3D Scene composition to its Scene input. Connect its output to [Render Video](render-video.md) to export MP4.

Use an instruction such as “Move the pillar back one meter and keep the suitcase path unchanged,” or supply deterministic operations through the API. Preserve selected objects with `lockedObjectIds`. Optional image/video references provide additional layout, motion or appearance guidance.

## Editing contract

`POST /v1/3d-scene/edit` takes `scenePlan` and `expectedRevisionId`, plus either `prompt` or `operations`. A revision mismatch is rejected. A successful edit produces a new `revisionId` with the old revision as `parentRevisionId`; the input plan remains unchanged.

Supported operations:

| Operation | Fields |
|---|---|
| `set-object` | `objectId`, `changes` (object fields other than ID) |
| `add-object` | `object` |
| `remove-object` | `objectId` |
| `set-camera` | `changes` |
| `set-lighting` | `changes` |
| `set-background` | `color` |

New references merge with existing ones by reference ID; supplying the same ID replaces that reference. The combined list must remain within the generation limits. Whole video clips are supported in v1; trim a segment first.

Canvas pose controls edit the visible frame: an animated channel gets an updated or inserted keyframe, while a static channel changes its base value. API operations update exactly the fields supplied; to change a keyed pose, include its keyframe changes.

The complete edited scene is validated, including object IDs, hierarchy and animation frames. Edits cannot silently leave orphaned parents or references. Deterministic operations do not call an LLM. Instruction-based edits use the selected authoring model.

```typescript
const edited = await client.nodes.runAndWait("edit-3d-scene", {
  scenePlan: scene.scenePlan,
  expectedRevisionId: scene.scenePlan.revisionId,
  operations: [{ op: "set-camera", changes: { focalLengthMm: 50 } }],
});
```

Poll the returned job ID for `output_data.scenePlan` and `changeSummary`. Retain the previous revision for undo or comparison. The canvas preserves newer direct edits when an older in-flight generation finishes.

A **failed** job on an advanced engine can still carry `output_data` — the draft
it built, or the recipe it was refused for. The shapes and what to do with each
are on [Generate 3D Scene](generate-3d-scene.md#api-and-sdk); this node's failures
report them identically, including how a refused draft reaches the canvas from a
single-node Run, a workflow Run and a reload.

A **completed** instruction edit reports the same authoring fields a generate
does, because it runs the same authoring lane: `repairPasses`, `admissionRetries`,
`mechanicalPasses`, `restoredAssertions`, `SCENE_AUTHORING_ASSUMPTION` warnings —
and `metadata.review` when the edited scene passed every mandatory check but did
not get the visual review's approval, either because the review objected
(`verdict: "refused"`) or because it produced no usable verdict and nobody judged
the scene (`verdict: "unavailable"`, whose `reason` is `"provider"` when the review
never reached its provider and `"unusable"` when the provider answered unusably). `validation.status` is `passed` on both, so
test for `metadata.review` and branch on `verdict` rather than reading the status.
The full shape is on
[Generate 3D Scene](generate-3d-scene.md#api-and-sdk) and
[3D Render Pro](pro-3d-render.md#when-a-scene-that-passed-is-delivered-unapproved).
Deterministic operations call no model and carry none of this.

An MP4 is not an editable scene. To work from video alone, provide it as a reference to Generate 3D Scene and inspect the reconstructed result.

LLM edits are model-priced on Cloud; use the model-cost API for current pricing. Deterministic operations have no LLM charge. Rendering is a separate operation.

## Credits

Deterministic operations and local property edits cost **0 credits**. Instruction edits are charged like [Generate 3D Scene](generate-3d-scene.md) authoring: for the tokens the LLM call actually used, at the selected model's rate ([LLM model rates](../../pricing/llm-models.md)) — a typical edit on the default Claude Sonnet 5.5 is estimated at ≈6 credits<!-- credits: 3d-scene:claude-sonnet-5.5 --> — plus optional video analysis. Rendering an edited revision is charged separately, by frame size: **55 credits**<!-- credits: render-video --> up to 1920 px on the longest side, **83**<!-- credits: render-video:3d-large --> above that up to 5.12 megapixels, **138**<!-- credits: render-video:3d-xlarge --> for a larger frame — see [what a 3D scene render costs](render-video.md#what-a-3d-scene-render-costs). Instance prices come from the model-cost API.

Both nodes support [prompt pre/post text](../../prompt-pre-post-text.md). The canvas applies those affixes when it submits the instruction.
