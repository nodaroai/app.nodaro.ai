---
"@nodaro/shared": minor
---

3D Render Pro: one still per shot alongside the MP4.

`Pro3DRenderJobOutput` gains an optional `shotStills` — `{ shotIndex, frame,
assetId, url }[]`, ordered by `shotIndex` — and `pro3DRenderShotStills(output)`
is the tolerant reader every surface uses to get it in shot order.

`shotIndex` is the 0-based position in the v2 composition's `shots` array and
`frame` is that shot's own first frame in the composition's frame space, so a
still can be lined up against the exported video without re-deriving shot
boundaries. A v1 (single-shot) scene has exactly one still, index 0 at frame 0.

The field is OPTIONAL and the reader schema is passthrough, so a result
produced before shot stills existed still parses as a complete result; a
consumer should read `output.shotStills ?? []`.
