---
"@nodaro/shared": patch
---

Video Depth: `videoDepthCreditId` names one price row per whole second of the clip for Depth Anything per frame too (`depth-anything-frames:<n>s`, the length rounded up after ignoring up to 0.05 s past a whole second, `:1s` … `:80s`) in place of its length buckets; a length that is unknown, not positive or past 80 s names the `:80s` row. The model catalog's `depth-anything-frames` pricing lists representative per-second rows, and its bare row is now the price of the 80 s row. `VIDEO_DEPTH_BUCKETS` stays exported; no price row is picked from it any more.
