---
"@nodaro/shared": minor
---

A video request with no `duration` is charged for the length the model renders by default, and one the model does not offer is charged for the nearest length it does. `MODEL_CATALOG` entries gain `defaultDuration`; `pricedOutputDurationSec` reads it (and snaps with the new `snapToNearestDuration`, the rule every runner uses), so the credit identifier, the reference-video reservations and every estimate share one funnel. `videoDefaultDurationSec` is new; `PRICING_DEFAULT_DURATION_SEC` is now a deprecated, derived view of the catalog. `pricedVideoSelection` returns the charged length for every length-priced model, so the wire carries what is priced. Seedance 2 / Fast / Mini now reserve 8 s (was 5 s) for an unset-duration reference-video run, and Grok i2v 6 s.
