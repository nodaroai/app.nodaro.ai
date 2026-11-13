---
"@nodaro/shared": minor
---

Video Analysis's `fast` tier resolves to `gemini-3.8-flash` (`VIDEO_ANALYSIS_TIERS.fast`): the provider stopped serving `gemini-3-flash`. `gemini-3.8-flash` gains video and audio input in `LLM_MODALITY_CAPS`, which makes it a `VIDEO_ANALYSIS_LLM_MODELS` member, and `gemini-3-flash` joins `VIDEO_ANALYSIS_LEGACY_MODELS` (`fast`), so a stored raw `llmModel: "gemini-3-flash"` keeps resolving and keeps its own price rows.

`VIDEO_ANALYSIS_BUCKET_CREDITS` gains the `video-analysis:gemini-3.8-flash:<bucket>s` rows (186 / 193 / 534 / 880), and the `mixed` (275 / 298 / 748 / 1209) and `smart` (416 / 508 / 1280 / 2097) rows move with it, as their plans also run the fast model. `VIDEO_AUDIT_BUCKET_CREDITS`'s `video-audit:auto` family follows the fast row (401 / 483 / 1197 / 1953). Every other row is unchanged.

`MODEL_CATALOG` gains `gemini-3.8-flash-video-analysis` ("Video Analysis (Fast)"), and `gemini-3-flash-video-analysis` is relabelled "Video Analysis (Fast — previous)".
