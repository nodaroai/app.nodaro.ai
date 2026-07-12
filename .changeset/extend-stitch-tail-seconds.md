---
"@nodaro/shared": minor
---

`SEEDANCE_2_EXTEND_STITCH` gains `referenceTailSeconds` (1) — the extend-video worker now passes only the source's last second as the `@video_1` reference (with the source's last frame as the i2v first-frame anchor), and the existing `trimTailFrames`/`trimHeadFrames` are documented as the smart-cut fallback trims.
