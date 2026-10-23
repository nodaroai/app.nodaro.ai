---
"@nodaro/shared": minor
"@nodaro/prompts": minor
---

Two new KIE video models in the catalog: **Kling 4.0** (`kling-4`) and **Kling 4.0 Keyframes** (`kling-4-keyframes`), made by Kuaishou.

`@nodaro/shared`:

- Catalog entry `kling-4` (reference-to-video): text-to-video with nothing connected, or up to 10 reference images, 5 reference videos (2–30 s each), 7 characters as named subjects and 3 voice clips — 15 materials in all. A wired start frame joins the reference images. Features `audio`, `reference-image`, `reference-to-video` and the new `character-subjects` (a wired Character reaches the model as a named subject). Reference videos are taken, but `video-reference` is not declared, so it derives into `GVP_SUPPORTED_PROVIDERS` (keyframes only) and not `GVP_EXTEND_PROVIDERS`.
- Catalog entry `kling-4-keyframes` (keyframe-to-video): a start frame, up to 8 in-between frames (the Image References, in order) and an end frame, with the new `keyframes` feature. Its frames ride their own channel (`VIDEO_PROVIDERS_WITH_SEPARATE_FRAME_CHANNEL`), and `deriveGvpSupportedProviders` leaves any `keyframes` model out.
- Both: both modes, 3–30 s (default 5), `720p` (default) / `1080p`, aspect `auto` / `16:9` / `9:16` / `1:1` / `21:9`, native audio always on (classified `ambient`), no seed, prompts up to 8,000 characters. Series `Kling`, so both are closed to the free tier.
- New exports `KLING_4_PROVIDERS` / `isKling4Provider()`, `KLING_4_DEFAULT_RESOLUTION`, `normalizeKling4Resolution()`, `KLING_4_MAX_MIDDLE_FRAMES` and `kling4KeyframeFrameCap()` (the provider's frames-per-duration table: 3 s → 4 … 9 s or longer → 10).
- Credit identifiers: `kling-4:<N>s:<resolution>` and `kling-4-keyframes:<N>s:<resolution>` per second; a `kling-4` run with a reference video bills `kling-4:<N>s:<resolution>-ref` (new `VIDEO_REF_RATE_PROVIDERS`), the per-second rate of output + max(output, reference seconds). New `billsReferenceVideoSeconds()` names the models whose reference-video runs bill the clips' seconds (Seedance 2, Kling 4.0).
- `VIDEO_REF_LIMITS_BY_PROVIDER` rows gain an optional `materials` budget (Kling 4.0: 15), which `videoCharacterRefProblem` checks in place of the Gemini Omni unit budget; it now also takes an optional `audioCount`.
- `VideoCharacterReference` gains optional `extraImageUrls` (up to `VIDEO_CHARACTER_EXTRA_IMAGES_MAX`, 3); new `characterReferencesFromWired()` groups wired Character entries into one reference per character, portrait first.
- `uiResolutionFill` / `uiDurationFill` / `uiAspectRatioFill` return 720p / 5 s / `auto` for both ids.

`@nodaro/prompts`:

- A new `KLING_4_DOCTRINE` entry for both ids: the two endpoints, how each material is named in the prompt (`@image_1`, `@video_1`, a character's `@Name`, `@audio_1`; `@first_frame` / `@keyframe_N` / `@last_frame`), the frame cap per duration and the reference-video behaviour, built from the provider's contract and live probes.
- Prompt-wizard capability lines for `kling-4` and `kling-4-keyframes`.
