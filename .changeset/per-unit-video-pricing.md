---
"@nodaro/shared": minor
---

Two pricing helpers, so every surface that names a Video SFX or LTX 2.3 Pro Extend price reads the same rule. `videoSfxCreditId(seconds)` returns the `replicate-mmaudio:<n>s` price row for an input video's length (with `VIDEO_SFX_PRICING` naming the 300-second cap and the 8-second fallback). `ltxExtendDurationSec(value)` returns the seconds an LTX extend adds, a whole number from 1 to 20 that defaults to 6, and `LTX_EXTEND_PER_SECOND_CREDIT_ID` names its per-second price row.
