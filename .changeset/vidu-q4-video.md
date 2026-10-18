---
"@nodaro/shared": minor
"@nodaro/prompts": minor
---

A new KIE video model in the catalog: **Vidu Q4** (`vidu-q4`), made by ShengShu.

`@nodaro/shared`:

- Catalog entry `vidu-q4`: one id over two provider endpoints, picked by what is wired — a start frame alone runs image-to-video (the output keeps the frame's shape, the prompt is optional); any reference image or reference audio runs reference-to-video (1–15 reference images, up to 3 reference audio clips, a prompt required, aspect `16:9` / `9:16` / `1:1` / `4:3` / `3:4`). A wired start frame joins the reference images in reference mode. 3–16 s in whole seconds (default 5), `540p` / `720p` (default) / `1080p` / `2k` / `4k`, native audio behind a boolean `audio` lever (on by default, classified `ambient`), no seed.
- `modes` is `["i2v"]`: the provider has no text-to-video and no start/end-frame mode, so `vidu-q4` joins `IMAGE_TO_VIDEO_PROVIDERS`, the image-required section of `TEXT_TO_VIDEO_PROVIDERS`, and the derived `VIDEO_PROVIDERS_REQUIRING_IMAGE`. No `end-frame` feature. It derives into `GVP_SUPPORTED_PROVIDERS` (keyframes only — no `video-reference`, so not `GVP_EXTEND_PROVIDERS`).
- A new maker, `shengshu` ("ShengShu").
- New exports `VIDU_Q4_PROVIDERS` / `isViduQ4Provider()`, `VIDU_Q4_DEFAULT_RESOLUTION` and `normalizeViduQ4Resolution()` — the provider's wire enum is lowercase, so the normalizer only folds case and collapses an unknown value to 720p; the credit identifier bills through the same function, so the billed tier always matches the rendered one.
- New exports `VIDEO_REF_AUDIO_RULES` and `checkRefAudioRules()` (types `RefAudioRule`, `RefAudioProbe`, `RefAudioCheck`): a provider's documented per-clip reference-audio contract (accepted formats, minimum and maximum length). Vidu Q4 accepts MP3 only, 3–12 s per clip; an unreadable probe field is ignored, never rejected.
- Credit identifiers: `vidu-q4:<N>s:<resolution>` — one per-second ladder for both endpoints and for audio on or off (no reference or audio dimension). An omitted resolution prices the 720p tier and an omitted duration the 5 s tier, matching what renders; `uiResolutionFill` / `uiDurationFill` return the same defaults.

`@nodaro/prompts`:

- A new `VIDU_Q4_DOCTRINE` entry: the two-endpoint mode pick, the start-frame fold in reference mode, the reference caps and the MP3 / 3–12 s audio rule, built from the provider's contract only.
- Prompt-wizard capability lines for `vidu-q4`.
