---
"@nodaro/shared": minor
---

Scene3D: raise the dimension cap to 2560px and document the baked-rig boundary.

`SCENE3D_LIMITS.maxDimensionPx` and `SCENE3D_V2_LIMITS.maxDimensionPx` go from 1920
to **2560**, on both axes. The widening is additive — every previously valid plan
stays valid — and it is backed by a measurement rather than a guess: on the
`swangle` software path a production-representative render costs 65 ms/frame at
1920×1080, 97 ms at 2560×1440 and 154 ms at the square 2560×2560 worst case. At
the contract's 3600-frame ceiling that squares to ~9.2 minutes against the render
worker's 25-minute budget, and peaks at 3.1 GB against a 32 GB container limit.

2560 covers true 21:9 at 1097 and the DCI-adjacent widths that 1920 excluded.

The module docstring now also states, next to the existing determinism rule, that
camera and object RIGS — spline rails, follow-path and track-to constraints, and
procedural noise — are deliberately absent from this contract. They are authored
upstream and arrive baked (v1 as keyframes, v2 as one camera sample per frame).
The format carries no constraint or noise vocabulary on purpose, because a rig
evaluated in two different renderers cannot be guaranteed to agree frame for
frame. The absence is a boundary, not an unfinished TODO.
