---
"@nodaro/shared": minor
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Video Mask and Mask Composite. `@nodaro/shared` adds the wire contracts (`VideoMaskRequest`, `VIDEO_MASK_LIMITS`, `videoMaskCreditId`, `MaskCompositeRequest`, `MASK_COMPOSITE_*`, `resolveMaskCompositeSettings`); `@nodaro/sdk` adds `media.videoMask()` (`POST /v1/video-mask` — a text-prompted SAM 3 mask video) and `media.maskComposite()` (`POST /v1/mask-composite` — a foreground video over a background video through a mask); `@nodaro/cli` adds `nodaro media video-mask` and `nodaro media mask-composite`.
