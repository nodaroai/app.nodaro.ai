---
"@nodaro/shared": minor
"@nodaro/sdk": patch
---

`VIDEO_MASK_RECIPE` (`@nodaro/shared/media`): the version of what a Video Mask run's mask looks like for a given clip and settings, starting at `"2026-10-25"`. Every finished `video-mask` job now reports it as `output_data.recipe`, so a mask stored and reused later can tell when the algorithm that made it has changed.

`@nodaro/sdk`: `media.videoMask`'s documentation lists the output's new `recipe`.
