---
"@nodaro/sdk": minor
---

`castSwap.styleChoice()` answers `preciseArtStyle` per engine: whether a Precise run (no `style`, or `"precise"`) takes an art style (`direction`) there, as a Flex run does — Precise's edit of the clip, drawn in the art style. `CastSwapStyleChoice` gains `preciseArtStyle?: Partial<Record<CastSwapEngine, boolean>>`; Nodaro Motion Pulse is always `false` (it takes no art style), and an older server leaves it out (read it as `false` for every engine). An art style is not a Precise run's change on its own: a Precise run with nothing else to change is still refused. Where it is `true`, an engine whose style is forced to Precise keeps a Flex request's art style. The doc comment of `CastSwapParams.direction` now says which runs take one and which codes refuse it.
