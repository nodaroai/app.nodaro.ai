---
"@nodaro/sdk": patch
---

Nodaro Motion and trend runs at 480p are plain unless they ask for a draft. `CastSwapParams.draft` and `TrendRunRequest.draft` now document `false` as the default: a run that leaves `draft` out at 480p is plain 480p, and `draft: true` (Nodaro Motion Prism, 480p only) makes a draft whose same take `castSwap.fullQuality()` can finish at 1080p. Full Quality is offered on Prism drafts only: a plain run is refused with `not_a_draft`, and Nodaro Motion Pulse runs have no Full Quality (run them again at 1080p). `CastSwapFullQualityKind` keeps `"new-take"` for code that reads it; a quote no longer answers it. No type changes.
