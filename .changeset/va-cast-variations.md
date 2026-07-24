---
"@nodaro/shared": minor
---

video-analysis: per-slot appearance variations + scene bindings (cast-variations spec stage 1) — `slotVariationSchema` (non-default looks only, reserved `"default"` rejected, `refImageUrl` carried from day one), `entitySlotSchema.variations` capped at `VIDEO_ANALYSIS_MAX_VARIATIONS`, `windowSceneBase.slotVariations` (out-of-band scene→look bindings inherited by both the window layer and `analyzedSceneSchema`), the closed variation slug vocabulary (`VIDEO_ANALYSIS_VARIATION_SLUGS`), and the merge-side binding helpers `rewriteSceneBindings` / `dropUnknownBindings`.
