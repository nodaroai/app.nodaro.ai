---
"@nodaro/shared": patch
---

Video Depth: `videoDepthCreditId` names one price row per whole second of the clip for Video Depth Anything (`video-depth-anything:<n>s`, the length rounded up, `:1s` … `:300s`) in place of its 15/30/60/120/300 s buckets; a length that is unknown, not positive or past 300 s still names the `:300s` ceiling. Depth Anything per frame (`depth-anything-frames`) keeps its length buckets. The model catalog's `video-depth-anything` pricing lists representative per-second rows.
