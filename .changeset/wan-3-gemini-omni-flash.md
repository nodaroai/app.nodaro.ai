---
"@nodaro/shared": minor
"@nodaro/prompts": minor
---

Three new KIE video models in the catalog: **Wan 3.0** (`wan-3`), **Wan 3.0 Prime** (`wan-3-prime` — the high-speed variant, faster turnaround at a higher per-second price, not a higher-quality tier) and **Gemini Omni Flash** (`gemini-omni-flash` — the cheaper, faster sibling of `gemini-omni-video` on an identical request shape).

`@nodaro/shared`:

- Catalog entries for all three, each joining `IMAGE_TO_VIDEO_PROVIDERS` and `TEXT_TO_VIDEO_PROVIDERS` (one id per SKU serves both modes — no `VIDEO_MODE_ALIASES` twin, no `VIDEO_PROVIDERS_REQUIRING_IMAGE` gate). All three derive into `GVP_SUPPORTED_PROVIDERS`; Wan 3.0 also derives into `GVP_END_FRAME_PROVIDERS` via its `end-frame` feature, and none of them joins `GVP_EXTEND_PROVIDERS` (`video-reference` is deliberately not declared — the provider's `input + output ≤ 30 s` ceiling cannot be expressed in the engine's segment bounds).
- Wan 3.0: 2–30 s in whole seconds, `480p` / `720p` / `1080p`, aspect `adaptive` (default) / `16:9` / `4:3` / `1:1` / `3:4` / `9:16` (no `21:9`), reference limits 10 images / 5 videos / 5 audio (each clip 1–15 s, ≤ 15 s combined per type). Its reference arrays are **mutually exclusive** with the first/last frame parameters on the provider's wire, so a wired start/last frame folds into the reference pool — appended after the caller's own images and bound in the prompt — exactly as on Seedance 2 and Hailuo 3; the pair is never sent together.
- New exports: `WAN_3_PROVIDERS` / `isWan3Provider()` and `GEMINI_OMNI_PROVIDERS` / `isGeminiOmniProvider()` — exact-membership family predicates that replace the literal id comparisons deciding V2V routing, the reference quota, the mode swap and the resolution/aspect panels, so a new SKU inherits the behaviour instead of silently diverging. Plus `WAN_3_DEFAULT_RESOLUTION` and `normalizeWan3Resolution()`, the single place the provider's uppercase wire spelling is produced (everything internal stays lowercase).
- New exports `uiAspectRatioFill` / `uiResolutionFill` / `uiDurationFill` — the catalog-derived UI defaults for the unified video nodes, previously private to the backend DAG payload builder. Wan 3.0 is the first provider whose declared default (720p, 5s) is not index 0 of its ascending catalog ladders, so the run strip, the config-panel fail-safe and the enqueued payload all read the one helper instead of `resolutions[0]` / `durations[0]` and cannot drift apart.
- `VideoAudioCapability.field` widens to `"generateAudio" | "sound" | "audio"` and `applyVideoAudioToggle` gains the matching branch, so Wan 3.0's own boolean audio lever (ambient track, on by default) is written to the right key. Wan 3.0 is classified `ambient`, not `audio_driven`.
- Credit identifiers: Wan 3.0 bills per second on a duration × resolution composite `<id>:<N>s:<resolution>`, and an omitted or unsupported resolution now collapses to the model's declared default tier rather than the first tier in the list, so the composite that is billed always matches the tier that renders. Gemini Omni Flash uses the sibling's shape — `gemini-omni-flash:<duration>`, `:4k:<duration>` and the flat `:vref` / `:4k:vref` video-edit rows — with an omitted duration falling back to the 8 s tier.

`@nodaro/prompts`:

- A new `WAN_3_DOCTRINE` entry, kept separate from the Wan 2.x doctrine on purpose: Wan 2.x teaches `Image 1` with a space, while Wan 3.0 binds references as `Image1` / `Video1` / `Audio1` without one. Content is provider-stated fact only (token format, the 10 / 5 / 5 caps and their duration windows, the wire-level frames-vs-references exclusivity, the 20,000-character prompt limit).
- `GEMINI_OMNI_DOCTRINE` now covers both SKUs, and the Gemini Omni i2v input resolver reads its quota per provider instead of assuming the Pro id.
