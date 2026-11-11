---
"@nodaro/shared": minor
---

A new KIE video model in the catalog: **Kling 4.0 Flash** (`kling-4-flash`), made by Kuaishou — the faster, lower-cost Kling 4.0 at 720p.

- Catalog entry `kling-4-flash`: one id over two provider endpoints, chosen by what is connected. A start frame on its own is the exact opening frame; everything else (plain text, reference images, reference videos, characters, or a start frame beside any of them) runs on the reference endpoint, where a start frame joins the reference images as on `kling-4`. Both modes, 3–20 s (default 5), `720p` only, aspect `auto` / `16:9` / `9:16` / `1:1` / `21:9`, native audio always on (classified `ambient`), no seed, no end frame, prompts up to 8,000 characters. Series `Kling`; unlike the other Kling models it is open to free credits, within their limits (3–4 s at 720p).
- Features `audio`, `reference-image`, `reference-to-video`, `character-subjects` and `voice-references`: up to 10 reference images, 5 reference videos and 7 characters (15 in all). There is no standalone voice: reference audio clip N becomes the voice of character N, in the order the characters are wired; a character needs 2–4 images to carry a voice, otherwise its clip is dropped, as is any clip past the last character. It derives into `GVP_SUPPORTED_PROVIDERS` (keyframes only, at 720p) and not `GVP_EXTEND_PROVIDERS`.
- `VIDEO_REF_LIMITS_BY_PROVIDER` rows gain an optional `audioBindsToCharacters` flag (set for `kling-4-flash`): its audio clips take no seat in the `materials` budget that `videoCharacterRefProblem` checks.
- `VIDEO_REF_VIDEO_DURATION_LIMITS["kling-4-flash"]`: reference videos 2–20 s each and 20 s together, refused before a run is reserved.
- New exports `KLING_4_FLASH_PROVIDER`, `isKling4FlashProvider()`, `KLING_4_FLASH_RESOLUTION` and `isKling4RunnerProvider()` (Kling 4.0, Kling 4.0 Keyframes and Flash). `KLING_4_PROVIDERS` / `isKling4Provider()` are unchanged and do not include Flash.
- Credit identifiers: `kling-4-flash:<N>s:720p` per second; a run with a reference video bills `kling-4-flash:<N>s:720p-ref`, the per-second rate of output + max(output, reference seconds) (`VIDEO_REF_RATE_PROVIDERS`, `billsReferenceVideoSeconds()`). Any resolution asked bills 720p.
- `uiResolutionFill` / `uiDurationFill` / `uiAspectRatioFill` return 720p / 5 s / `auto` for `kling-4-flash`.
