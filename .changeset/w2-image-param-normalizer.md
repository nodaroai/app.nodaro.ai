---
"@nodaro/shared": minor
"@nodaro/sdk": patch
---

Add `resolveNormalizedImageGen` (and its `NormalizedImageGen` result type) to
the public API. It snaps an image request's catalog-governed levers
(`aspectRatio` / `resolution` / `quality`) to a combination the model actually
accepts via `normalizeModelInput`, applied against the post-T2I→I2I-swap model
id, and computes the credit identifier from the **snapped** values.

`adjustments` is the disclosure contract: one entry per lever that changed,
each carrying `field`, `from`, `to` and a human-readable `reason`. `to` is
`undefined` when the lever was dropped because the model has no such setting.
The array is empty when the caller's values were already valid, and unknown
model ids pass through untouched.

`resolveImageGenCreditIdentifier` keeps its exact signature and return type and
now delegates to the new primitive, so the credit identifier is identical for
every already-valid input. Because both image routes compute the identifier
twice — the `creditGuard` CHECK and the `reserveCreditsForJob` DEBIT — and a
commit never collects an upward delta, putting the snap inside the primitive
keeps those two sites and the workflow orchestrator in agreement by
construction instead of by convention.

Also adds `IMAGE_ASPECT_RATIO_VALUES` (and its `ImageAspectRatio` element type)
— the ONE image aspect-ratio vocabulary the `/v1/generate-image`,
`/v1/image-to-image` and `/v1/edit-image` Zod enums are now built from, instead
of three literal lists that drifted. It is the union of every ratio any
`kind: "image"` catalog entry declares, so a ratio the picker offers can no
longer 400 at the route (that gap shipped twice — Wan 2.7's `8:1`/`1:8` and
Nano Banana 2 Lite's `4:1`/`1:4`), and a superset test fails the build if a new
model declares a ratio the tuple is missing. It bounds the VOCABULARY only; the
per-model gate stays the catalog snap, which corrects and discloses rather than
rejects.

Widens `MODEL_PARAM_NODE_TYPES` — the node-type gate `normalizeNodeModelParams`
reads at the workflow-JSON write boundary — to cover `modify-image` and
`edit-image` alongside `generate-image` and `image-to-image`. A node written
straight into workflow JSON by an agent, an import or a template never meets
the config panel's provider-aware dropdown or its stale-value effect, so those
two types carried the same un-healable invalid pairs the other two used to.
`edit-image`'s `targetResolution` is an upscale target, a field the normalizer
never reads, so its price is untouched by the widening.

The image node routes (`generate-image`, `image-to-image`, `edit-image`) now
return an optional `adjustments[]` alongside `jobId` when a parameter was
corrected; `RunNodeResult` types it as `RunNodeAdjustment[]`.
