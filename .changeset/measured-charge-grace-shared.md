---
"@nodaro/shared": minor
---

The steps that measure their input and round with no grace of their own now hold and charge a measured length up to 0.05 seconds past a mark at that mark (`CLIP_PRICE_GRACE_SEC`, the same grace Mask Composite, Video Mask and Video Depth price by). New exports read it: `videoSfxHeldCreditId(measuredSec)` (Video SFX's rows), `pitchTempoHeldCreditId(measuredSec)` (Pitch & Tempo's minutes) and `lipSyncHeldSeconds(rate, measuredSec)` (a per-second-rate Lip Sync model). The quote functions (`videoSfxQuoteCreditId`, `pitchTempoQuoteCreditId`, `lipSyncEstimateSeconds`) still read a length exactly, so a quote is never below the charge of a file up to 0.05 seconds past it.

`gracedMeasuredSec` (in `@nodaro/shared/media`): a measured length less the 0.05 s grace and float noise, the one arithmetic the held rows of Video SFX, Pitch & Tempo, Dubbing and OmniHuman 2.0 read.
