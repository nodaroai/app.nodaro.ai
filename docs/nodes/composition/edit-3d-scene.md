# Edit 3D Scene

Basic remains the default. Optional Advanced engines are advertised by
`GET /v1/3d-scene/capabilities`; an unavailable explicit engine is rejected
before starting a Basic edit or reserving its credits.

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

An MP4 is not an editable scene. To work from video alone, provide it as a reference to Generate 3D Scene and inspect the reconstructed result.

LLM edits are model-priced on Cloud; use the model-cost API for current pricing. Deterministic operations have no LLM charge. Rendering is a separate operation.

## Credits

Deterministic operations and local property edits cost **0 credits**. Instruction edits use the same LLM authoring tiers as Generate 3D Scene: **10 / 30 / 40 credits** for economy / standard / premium, plus optional video analysis. Rendering an edited revision costs **15 credits** separately. Instance prices come from the model-cost API.

Both nodes support [prompt pre/post text](../../prompt-pre-post-text.md). The canvas applies those affixes when it submits the instruction.
