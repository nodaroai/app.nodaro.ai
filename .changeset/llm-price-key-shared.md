---
"@nodaro/shared": minor
---

`llmPriceKey(feature, modelId, reasoningEffort?, advancedMode?)` (`@nodaro/shared/llm-models`): the price key of a metered LLM call — `<feature>:<modelId>`, plus `:direct` when the call is served on the vendor's own API (`llmServesDirect`). With no effort given, the default effort of the feature the call borrows its defaults from applies. `modelId` must be the resolved model (an empty id throws). Ask `POST /v1/credits/model-costs` for the key to get the call's estimated price. Also `LLM_FEATURE_DEFAULTS_FROM` / `llmDefaultsFeature(feature)`: which feature's defaults Generate Structured (`llm-structured`), Text to Picker (`text-to-picker`) and the Choose Best judge (`reduce:pick-best-llm`) run with.
