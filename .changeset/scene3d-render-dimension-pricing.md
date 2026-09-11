---
"@nodaro/shared": minor
---

Scene3D: price a render by its frame size.

New `scene3d-render-pricing` module — `scene3DRenderTier`,
`scene3DRenderTierCredits`, `renderVideoCreditId` and `pro3DRenderFrameUnit`,
plus the `SCENE3D_RENDER_TIERS` vocabulary and its two constants.

A render's work is per pixel per frame, and raising the frame cap from 1920 to
2560 px made frames renderable that measure ~97 ms/frame (2560×1440) and
~154 ms/frame (2560×2560) against ~65 ms at 1920×1080. One flat price across
that range is either an overcharge on the small frame everyone renders or a
giveaway on the large one. So a `3d-scene` render now resolves to one of three
tiers: **base** (longest side ≤ 1920 px, 1×), **large** (longer, up to 5.12
megapixels, 1.5×) and **xlarge** (longer, above 5.12 megapixels, 2.5×) — the
measured ratios rounded to halves, with the boundary at the midpoint of the two
measured frames.

Nothing gets more expensive: a frame whose longest side is at most 1920 px
keeps the bare `render-video` identifier and its existing price, whatever its
area, so every workflow that ran before the cap moved costs exactly what it
did. The two new identifiers describe only frames that could not be rendered at
all until it moved. Non-`3d-scene` renders are untouched.

`pro3DRenderFrameUnit` names the per-frame unit a 3D Render Pro render stage
reads, with the same tier suffix and the same base-keeps-its-spelling rule. The
tier RATES are deployment configuration (`model_pricing` rows); this module
carries only the shape of the price.
