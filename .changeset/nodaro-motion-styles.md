---
"@nodaro/shared": minor
---

`@nodaro/shared/models`: `CAST_SWAP_STYLES` (`["precise", "motion"]`) and the `CastSwapStyle` type — how a direct Nodaro Motion run follows its clip (`style`). `CAST_SWAP_FACE_MASK_TARGETS` adds `"body"` (the whole person), which only a trend clip that keeps its people as filmed takes.

`VIDEO_REF_VIDEO_DURATION_LIMITS["kling-4"]` adds `maxTotalSec: 30`: Kling 4 refuses reference videos that add up to more than 30 seconds, so such a set is refused before the run instead of failing at the provider.
