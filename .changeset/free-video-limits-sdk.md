---
"@nodaro/sdk": minor
---

`UserBalance.freeVideoLimits` (`{ enabled, maxSeconds }`): the free-credit video limits, present only while they apply to the signed-in account (it never paid). `BillingPlan.freeVideoLimits`: the same limits on the free plan of `billing.plans()`, readable signed out (`null` on a paid plan). Lock the video options the server would refuse (402 `free_video_limit`) with the functions of `@nodaro/shared/free-video-limits`.
