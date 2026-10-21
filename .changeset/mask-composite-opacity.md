---
"@nodaro/shared": minor
"@nodaro/sdk": patch
---

Mask Composite takes `opacity` (0–1, default 1): how strongly the foreground covers the background inside the mask — inside it the result is `opacity × foreground + (1 − opacity) × background`. `MASK_COMPOSITE_BOUNDS` gains `OPACITY_MIN` / `OPACITY_MAX`, `MASK_COMPOSITE_DEFAULTS` and `MaskCompositeSettings` gain `opacity`, and `resolveMaskCompositeSettings` clamps it. `client.media.maskComposite` documents the field (its `MaskCompositeRequest` carries it).
