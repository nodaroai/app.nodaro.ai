---
"@nodaro/shared": minor
---

The Meta Ads and Instagram per-post AI analysis gains a `premium-direct` rung (`@nodaro/shared/social`): `META_ADS_ANALYSIS_TIERS` is now the LLM credit rungs (`LLM_CREDIT_RUNGS`) and `metaAdsAnalysisTier(model)` returns the rung a call on that model bills on. A model served on its provider's own API (a `directOnly` one, e.g. `gemini-4-argon`) moves one rung up, so a premium one prices at `META_ADS_ANALYSIS_CREDITS_PER_AD["premium-direct"]` and on the `<scrape>:<tier>:analysis:premium-direct` / `<feature>-analysis:premium-direct` ids. Every other model returns exactly the tier, id and price it did before. New `llmCreditRung(modelId, reasoningEffort?, advancedMode?)` (`@nodaro/shared/llm-models`) is the rung half of `buildLlmCreditIdentifier`, for features with their own id shape.
