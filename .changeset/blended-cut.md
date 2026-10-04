---
"@nodaro/prompts": minor
---

A duration of Short on `seamless-match` and `jump-match` blends the cut. On those two transitions, `duration: "short"` now replaces the anti-blend sentence inside the transition's parentheses ("an abrupt single-frame hard cut, no dissolve, crossfade or superimposition; the two images never blend") with "instead of a hard cut, the two shots blend into each other over about 1 second" ("about 1 second" is the `short` row's own term). The rest of the clause is the hard cut's: Position still applies (`full` is still dropped), and there is no duration or intensity clause. Picked together, the two rows blend the same way, with the sentence once, in the first pick's parentheses.

**Prompt wording change:** Saved seamless-match or jump-match picks with Short blend from their next generation.

**When each path blends:** wherever the composer runs on 1.29.0, from that moment. On Nodaro, the platform deploy brings it to the canvas, to server-side workflow runs and to the Studio generations the server folds (the Studio production routes, including the MCP `generate_studio_clip` tool). The Studio editor's own generations follow with the Studio release that adopts 1.29.0. Until that release, the editor strips a take's way-out clause by re-rendering the clauses it knows, so when a take of a scene without shots carries a blended way-out clause written on the server, selecting it in the editor leaves that clause in the prompt, and the editor's next generation adds a hard-cut clause after it.

Everything else renders as before: the two rows at Auto, Instant, Medium and Long; `none`, `snap-to-black`, `match-cut`, `smash-cut`, `jump-cut` and `action-relay` at every duration; every transition that is not a cut; a cut picked with a non-cut, or with a cut that does not blend; and the `direction.transition` fold (`renderTransitionBases`), which has no duration.

New: `Transition.blendable` (set on `seamless-match` and `jump-match`), `TransitionTimingOption.blendsCut` (set on the `short` duration), `isBlendableTransition(id | ids)` and `blendedCutClause(duration)`. The picker catalog (`getPickerCatalog("transition")`) marks the two rows `blendable: true` and the `short` duration row `blendsCut: true`, beside `instant`. Like `instant`, the flags are on this catalog only, not on the wire projection (`GET /v1/picker-catalogs/transition`, the MCP `get_picker_catalog` tool).
