---
"@nodaro/shared": minor
---

LLM catalog: `gemini-3.7-flash` is retired. It leaves every model picker and advertised model list (`PICKABLE_LLM_MODELS`, `groupLlmModelsByVendor`, `orderedLlmModels`) but stays in `LLM_MODEL_IDS`, so saved nodes and API calls naming it keep validating and running. Its KIE lane now sends `gemini-3.8-flash`'s endpoint and declares it with the new `kieServedAs` field; its direct Google lane (and Advanced mode) still serves Gemini 3.7 Flash. `getLlmModel("gemini-3-8-flash-openai")` always resolves to `gemini-3.8-flash`, and the old `gemini-3-7-flash-openai` slug still resolves to `gemini-3.7-flash`. New: `LlmModelDef.retired`, `LlmModelDef.kieServedAs`, `PICKABLE_LLM_MODELS`, `pickableLlmModels(currentId?)`, `isLlmModelRetired(id)`.
