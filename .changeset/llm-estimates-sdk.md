---
"@nodaro/sdk": minor
---

`credits.modelCosts()` results carry the metered LLM estimates: `ModelCostsResult.estimates?: string[]` lists the identifiers whose figure is an estimate (show `~N`), and `ModelCostsResult.errorCodes?` says why an identifier in `errors` has no price (`llm_model_unpriced`). New `ModelCostResult` type for `GET /v1/credits/model-cost` (`estimate?: true`). Both fields are omitted for a batch of fixed-price identifiers, which answers exactly as before.
