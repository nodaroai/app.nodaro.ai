---
"@nodaro/prompts": patch
---

Cuts now read as true hard cuts. When every picked transition is instant (`none`, `snap-to-black`, `match-cut`, `smash-cut`, `seamless-match`, `jump-cut`, `jump-match`, `action-relay`), the composed transition text is followed once by the new `INSTANT_CUT_CLAUSE` ("an abrupt single-frame hard cut, no dissolve, crossfade or superimposition; the two images never blend"), in both hint modes and on both paths — `composeTransitionHintFromConnections` (the canvas node) and the direction registry's `transition` fold (via the new exported `renderTransitionBases`). The intensity clause is now dropped for an all-instant pick, like duration: it describes a transition's timing, and "with natural unhurried timing" on a match cut made video models render a dissolve. A mixed pick (a cut plus a non-cut) is unchanged.
