---
"@nodaro/shared": minor
---

`estimateLoopTrimAddonCredits` returns the Loop Trim add-on in the current credit unit: 10 credits per 5 seconds of output plus 10 per ~24 frames searched (`VIDEO_UTIL_PRICING.CREDIT_UNIT`), the same unit as Trim Video's smart loop cut. It returned the pre-redenomination figure, a tenth of that. New: `ltxRetakeDurationSec(value)` returns the seconds an LTX 2.3 Pro retake replaces (the window, at least 2), and `LTX_RETAKE_PER_SECOND_CREDIT_ID` names its per-second price row.
