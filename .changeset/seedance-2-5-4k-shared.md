---
"@nodaro/shared": minor
---

Seedance 2.5 renders native 4K. `MODEL_CATALOG["seedance-2-5"].resolutions` gains `"4k"` (with 8 s and 30 s 4K pricing anchors), and so does `seedance-2-5-extend`, whose 4K is offered only for a source that is already 4K (its short side 2160 pixels or more). `SEEDANCE_EXTEND_RATE_CREDIT_IDS` gains `"4k"` (`seedance-2-5-extend:4k:per-2s`).

New in `@nodaro/shared/models`: `EXPLICIT_4K_ONLY_VIDEO_MODELS`, `FOUR_K_SPELLINGS`, `explicitFourKOf`, `fourKSpellingReason`, `isFourKResolution` and `resolutionsALooseRequestMayLandOn`. On Seedance 2.5 (and Seedance 2.5 Extend) only an explicit 4K renders 4K: `4k`, `2160p` or `UHD`, in any case, each read as `4k` by the normalizers, the price ids, Lip Sync and Extend, with an adjustment when it was another spelling. Otherwise `normalizeVideoRequestParams` still snaps a size the model does not list (`2k`, `1440p`) to 1080p, and `seedanceLipSyncResolution` sends such a size at 1080p, as before, rather than at the new top tier. `normalizeModelInput` and `normalizeVideoRequestParams` now keep `4k` on Seedance 2.5 instead of moving it.
