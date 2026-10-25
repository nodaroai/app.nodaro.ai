---
"@nodaro/shared": minor
---

Video Mask `redetectEverySec`: `VIDEO_MASK_LIMITS.REDETECT_EVERY_SEC_MIN` / `_MAX` / `_STEP` (1 / 10 / 1), `VIDEO_MASK_DEFAULTS.redetectEverySec` (0 = off), `resolveVideoMaskRedetectSec`, and the optional `redetectEverySec` on `VideoMaskRequest` — detect the subject again every N seconds (the clip, or each shot with `perShot`, is sent in pieces of at most that length), so a subject that appears mid-shot is masked. Not a cut: `holdLastMask` holds across these boundaries. Slower; same price.
