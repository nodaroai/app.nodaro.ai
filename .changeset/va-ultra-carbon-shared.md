---
"@nodaro/shared": minor
---

Video Analysis gains the `ultra` tier: `VIDEO_ANALYSIS_TIERS.ultra` resolves to `gemini-4-carbon`, `VIDEO_ANALYSIS_TIER_ORDER` lists it right after `smart`, and `VIDEO_ANALYSIS_TIER_LABELS.ultra` is "Ultra". The default tier stays `pro`. `gemini-4-carbon` now declares video and audio input in `LLM_MODALITY_CAPS` (it was image-only), which makes it a `VIDEO_ANALYSIS_LLM_MODELS` member and lets LLM Chat send it video and audio references.

`VIDEO_ANALYSIS_BUCKET_CREDITS` gains the `video-analysis:gemini-4-carbon:<bucket>s` rows (349 / 375 / 1054 / 1745 base credits), above `mixed` and below `smart` in every bucket, and `MODEL_CATALOG` gains `gemini-4-carbon-video-analysis` ("Video Analysis (Ultra)"). No other price changes.
