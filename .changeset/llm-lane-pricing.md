---
"@nodaro/shared": minor
"@nodaro/sdk": patch
"@nodaro/cli": patch
---

LLM calls are priced on the lane they run on. `llmServesDirect(modelId, reasoningEffort, advancedMode)` is new: a call runs on the vendor's own API when Advanced mode is on, or when it carries a reasoning effort on a model whose effort only works there (`LlmModelDef.effortRequiresDirect` — the Claude family). `buildLlmCreditIdentifier` bills such a call one rung up on the new four-rung ladder `LLM_CREDIT_RUNGS` (`economy` / `standard` / `premium` / `premium-direct`), so a premium model served direct now bills `<feature>:premium-direct`; `llmCreditIdForRung` and `llmTierCreditIds` list the ids. `supportsAdvancedMode` now also covers models with a direct Anthropic lane (Claude), and `ADVANCED_MODE_UNAVAILABLE_REASON` says so. Every Claude model is KIE-first (`preferKie`), and `gemini-3.1-pro` is no longer direct-first. `CONTENT_RECIPE_IDEAS_CREDIT_IDS` gains the `:premium-direct` ids. The SDK's prompt-helper docs and the CLI's `--advanced` help say Advanced mode covers Gemini and Claude models.
