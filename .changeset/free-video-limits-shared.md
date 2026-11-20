---
"@nodaro/shared": minor
---

New subpath `@nodaro/shared/free-video-limits`: the free-credit video limits rule, the same one the server refuses a run with (HTTP 402, code `free_video_limit`), so an app can lock the video options it would refuse before a run. `freeVideoModelLock`, `freeVideoDurationLock` and `freeVideoResolutionLock` judge one option, `freeVideoLock` a whole request; each answers a structured `FreeVideoLock` (`model`, `upscale`, `extend`, `shortest`, `auto`, `duration`, `resolution` or `size`, with the model's label) or `null`. Also `FREE_VIDEO_LIMITS_DEFAULTS`, the types `FreeVideoLimits`, `FreeVideoRequest` and `FreeVideoModelLockOptions`, and the rule's lists and helpers. The limits to judge against come from the server: `freeVideoLimits` on `GET /v1/user/credits` (present only while they apply to the account) or on the free plan of `GET /v1/billing/plans`. Every name is also exported from the root.
