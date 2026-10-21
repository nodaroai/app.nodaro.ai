---
"@nodaro/shared": minor
---

`scrapeAnalysisPriceParts` / `SCRAPE_ANALYSIS_FEATURE` (`@nodaro/shared/social`): the two price parts of a Meta Ads or Instagram scrape with AI analysis while LLM calls are billed per model — the scrape's fixed id, the analysis model and the item count — one rule for the server's and a client's estimate. `resolveScriptModelId` / `SCRIPT_LEGACY_PROVIDER_MODELS` (`@nodaro/shared/llm-models`): the model a Generate Script call runs on (an explicit model, else a legacy script provider's, else the default). `scrapeAnalysisQuoteId` (`@nodaro/shared/social`): the whole analysis of such a scrape as one `<key>:<items>u` price id, which `POST /v1/credits/model-costs` and `GET /v1/credits/model-cost` answer with the figure the run is held at (rounded and marked up once).
