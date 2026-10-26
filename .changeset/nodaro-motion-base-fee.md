---
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Nodaro Motion quotes name the run's base fee `breakdown.base` (it was `breakdown.castSwap`), in both the run quote (`CastSwapEstimate`) and the Full Quality quote (`CastSwapFullQualityEstimate`).

`@nodaro/sdk`: the breakdown types `base`; `castSwap` stays, optional and deprecated, for an older server, which sends only that name. Read `base`, else `castSwap`.

`@nodaro/cli`: quotes label the part "Nodaro Motion" whichever name the server sent, and `--json` answers `base` only (an older server's `castSwap` renamed).
