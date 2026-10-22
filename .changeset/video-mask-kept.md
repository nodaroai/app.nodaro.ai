---
"@nodaro/sdk": patch
---

`client.media.videoMask`: the job's output now carries `kept` (boolean) — whether any region is left on any frame after the size and zone filters (false only for an empty mask). Read it rather than `coverage`, which is rounded to 4 decimals, so a mask of a few pixels reads 0 there.
