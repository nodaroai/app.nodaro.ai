---
"@nodaro/prompts": minor
---

A duration of Short on `seamless-match` and `jump-match` blends the cut. On those two transitions, `duration: "short"` now replaces the anti-blend sentence inside the transition's parentheses ("an abrupt single-frame hard cut, no dissolve, crossfade or superimposition; the two images never blend") with "instead of a hard cut, the two shots blend into each other over about 1 second" ("about 1 second" is the `short` row's own term). The rest of the clause is the hard cut's: Position still applies (`full` is still dropped), and there is no duration or intensity clause. Picked together, the two rows blend the same way, with the sentence once, in the first pick's parentheses.

**Prompt wording change:** Saved seamless-match or jump-match picks with Short blend from their next generation.

Everything else renders as before: the two rows at Auto, Instant, Medium and Long; `none`, `snap-to-black`, `match-cut`, `smash-cut`, `jump-cut` and `action-relay` at every duration; every transition that is not a cut; a cut picked with a non-cut, or with a cut that does not blend; and the `direction.transition` fold (`renderTransitionBases`), which has no duration.

New: `Transition.blendable` (set on `seamless-match` and `jump-match`), `TransitionTimingOption.blendsCut` (set on the `short` duration), `isBlendableTransition(id | ids)` and `blendedCutClause(duration)`. The picker catalog (`getPickerCatalog("transition")`) marks the two rows `blendable: true` and the `short` duration row `blendsCut: true`, beside `instant`. Like `instant`, the flags are on this catalog only, not on the wire projection (`GET /v1/picker-catalogs/transition`, the MCP `get_picker_catalog` tool).
