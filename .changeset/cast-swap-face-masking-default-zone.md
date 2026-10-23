---
"@nodaro/shared": minor
"@nodaro/sdk": minor
---

Cast Swap face masking leaves 10 % margins at the left and right of the frame by default: a face centred there (someone walking in at the edge) is not masked. `CAST_SWAP_FACE_MASKING_DEFAULTS` gains `zone: { leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 }` and names the default fill, `fill: "blur"`. The SDK's `CastSwapFaceMasking.zone` documents that default and now also takes `null`, which, like all four margins 0, means no margins.
