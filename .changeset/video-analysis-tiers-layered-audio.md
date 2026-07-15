---
"@nodaro/shared": minor
---

Video-analysis robustness: quality tiers + layered audio.

- **Quality tiers** — new `VIDEO_ANALYSIS_TIERS` (`fast`/`pro`), `resolveVideoAnalysisModel`, `VIDEO_ANALYSIS_TIER_LABELS/ORDER`, and `DEFAULT_VIDEO_ANALYSIS_*` (default `pro`). Users select a tier; the underlying model is never surfaced. `resolveVideoAnalysisModel` accepts a tier or a raw model id (back-compat) and falls back to the default.
- **Layered audio (breaking shape change to `WindowAnalysis`/`VideoAnalysisResult`)** — a scene's `audio` is now an ARRAY of concurrent layers (`AudioLayer[]`) instead of a single `{mode,content,voice}` object, so simultaneous music + speech + sfx are all captured; an empty array means silence and the `silence` mode is removed. All in-repo consumers are updated; external consumers of `VideoAnalysisResult.audio` must read it as an array.
