---
"@nodaro/shared": minor
---

`resolveTopazUpscale()` collapses the Topaz image-upscale node's two levers onto the one parameter KIE accepts (`upscale_factor` ∈ 1/2/4) and returns the credit tier that matches what is actually sent. The legacy `targetResolution` (2K/4K/8K) is accepted and mapped forward (8K → the 4x tier, with an adjustment; an invalid factor falls through to a legacy tier rather than freezing the default first). A valid `upscaleFactor` overriding a disagreeing stored `targetResolution` is disclosed via an informational adjustment rather than dropped silently. Consumers must pass the returned `creditTier` — not the raw request value — into `buildCreditModelIdentifier`.

The `topaz-image-upscale` `MODEL_CATALOG` entry follows: it no longer declares `resolutions` (the 2K/4K/8K menu had no provider parameter behind it) and its `pricing[]` drops the `:8K` row, which nothing can reserve any more. The `:8K` price key stays in the platform's static/DB pricing so historical usage still resolves. `MODEL_RECOMMENDATIONS` stops advertising an 8K Topaz tier.
