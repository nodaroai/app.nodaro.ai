---
"@nodaro/shared": minor
"@nodaro/sdk": patch
"@nodaro/cli": minor
---

Video Mask `zone` and `perShot`, on every surface.

- `@nodaro/shared`: `VIDEO_MASK_LIMITS.ZONE_MARGIN_PCT_MIN` / `ZONE_MARGIN_PCT_MAX` (0–49 % a side), `VIDEO_MASK_DEFAULTS.zone` (`null`, off), `VIDEO_MASK_DEFAULTS.perShot` (`false`, off), the `VideoMaskZone` type (`{ leftPct, rightPct, topPct, bottomPct }`) and `resolveVideoMaskZone`, which reads a zone the way the region filter does (margins clamped to 0–49, anything else 0, all 0 = null).
- `POST /v1/video-mask` accepts `zone`: only the regions whose bounding-box centre lies inside the inner rectangle the margins leave are kept, after the size cuts and before `holdLastMask`. It accepts `perShot`: the clip's scene cuts are found first and every cut starts a new model request, so the subject is detected again in every shot (a subject that appears after a cut is found) and `holdLastMask` never carries a mask across a cut; each shot's mask is fitted to that shot's exact frame count, so a clip with no cut gives the same mask, fitted to the clip's exact frame count. The job's output reports `shots`.
- `@nodaro/sdk`: `VideoMaskRequest` (and so `client.media.videoMask`) gains `zone?: { leftPct?, rightPct?, topPct?, bottomPct? } | null` (each 0–49 % of the frame, a margin left out is 0; null = off) and `perShot?: boolean`.
- `@nodaro/cli`: `nodaro media video-mask` gains `--zone L,R,T,B` (each margin a plain decimal — `5`, `5.`, `.5` — as the API reads it) and `--per-shot`.
