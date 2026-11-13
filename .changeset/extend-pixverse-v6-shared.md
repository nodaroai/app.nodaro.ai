---
"@nodaro/shared": minor
---

PixVerse V6 joins Extend Video: **`pixverse-v6-extend`**, a new `EXTEND_VIDEO_PROVIDERS` member with its own catalog entry (`MODEL_CATALOG["pixverse-v6-extend"]`, made by PixVerse). It extends any video by URL natively: the whole source goes to PixVerse's own extend, and the run joins only the new seconds onto your original clip. 1–15 s added (default 5), at 360p, 540p, 720p or 1080p (default 720p), with a sound switch (on unless turned off); it takes no reference images. Its own catalog entry lets a deployment withhold or release it apart from PixVerse V6 Max.

- New in `@nodaro/shared/models`: `PIXVERSE_V6_EXTEND_PROVIDER`, `PixverseExtendProvider` and `isPixverseExtendProvider()`; `CatalogExtendProvider` and `isCatalogExtendProvider()`, the Extend Video providers whose seconds added and resolution come from their own catalog entry and are priced one row per second and resolution (the tail recipes and PixVerse V6); `extendHasSoundSwitch()`, true for Seedance's and PixVerse V6's.
- New in `@nodaro/shared/credits`: `pixverseExtendQuality(resolution?)` (360p / 540p / 720p / 1080p as asked, `480p` at the nearest offered, 540p, anything else at 720p) and `pixverseExtendCreditId(duration?, resolution?, generateAudio?)` (`pixverse-v6-extend:<N>s:<quality>`, `:audio` appended unless `generateAudio` is `false`); `catalogExtendResolution()` and `catalogExtendCreditId()`, one builder for every catalog extend provider.
- `buildVideoCreditModelIdentifier` prices `pixverse-v6-extend` on its own rows, its sound read from `generateAudio`, else `sound`.
- `MAX_VIDEO_PROMPT_CHARS_BY_PROVIDER["pixverse-v6-extend"]` is 5000.
