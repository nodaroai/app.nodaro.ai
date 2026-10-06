---
"@nodaro/shared": minor
---

Caption plans, layer plans and pass-through for workflow video nodes; shared caption segment schema.

- `parseCaptionPlan` and `styleCaptionPlan`: validate a timed caption plan and turn it into Add Captions segments.
- `captionSegmentInputSchema`, `captionFontWeightSchema` and `findSegmentOverlap` now live here (one definition for the API and both workflow engines).
- Video Overlay: `parseVideoOverlayLayerPlan`, plan layers in `assembleVideoOverlayRequest`, the `invalid_layer_plan` error.
- `combineVideosPassThrough`, `videoOverlayPassThrough`, `captionPlanPassThrough`.
- `FAN_OUT_ALL_OR_NOTHING_TYPES`, `fanOutItemMeta`, `clipNotesFrom`.
- `findRestrictedPickerValue` (per-field picker restrictions), `INPUT_FIELD_EXTRA_KEYS`.
- `UGC_NODE_TYPES`, `UGC_NODE_RUN_STATE_KEYS`, `UGC_OVERRIDABLE_FIELDS`, `stripUgcRunState`, `findUgcLockedFields`.
- `ugcCallToRouteBody`.
- A Video Overlay plan layer without an image fails with "Plan layer <n>: no image — set imageUrl on this layer in the plan." (handle layers keep their wording).
