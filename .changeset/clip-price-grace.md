---
"@nodaro/shared": minor
---

`pricedClipSeconds` and `CLIP_PRICE_GRACE_SEC`: the whole seconds Video Depth (both providers), Video Mask, Mask Composite and the face mesh price a clip at, its length rounded up after ignoring up to 0.05 s past a whole second. `videoDepthCreditId`, `videoMaskCreditId`, `videoFaceMeshCreditId` and `maskCompositeUnits` read it. A 12 s cut of a 29.97 fps clip can come out 12.012 s long and is priced as 12 s; a 15 s cut, 15.015 s long, stays in Depth Anything per frame's 15 s tier.
