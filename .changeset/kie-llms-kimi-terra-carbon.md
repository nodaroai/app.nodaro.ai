---
"@nodaro/shared": minor
---

LLM catalog gains three models (`@nodaro/shared/llm-models`), all taking text and image input:

- `kimi-k3.1-pro` (Kimi K3.1 Pro, premium, vendor `moonshot`): reasoning `low | high | max`, reasons by default, enforced structured output.
- `gpt-6.1-terra` (GPT-6.1 Terra, standard, vendor `openai`): reasoning `low | medium | high | xhigh | max` (no `none`: a `none` request runs at Auto), enforced structured output. Its price depends on the effort a call sends (`effortPriced`).
- `gemini-4-carbon` (Gemini 4 Carbon, premium, vendor `google`): reasoning `low | medium | high`, reasons by default, served on the aggregator first with Google's own API as its fallback (and under Advanced mode). It has no trusted structured-output mode, so it is not a `STRUCTURED_VISION_MODELS` member; its schema is still sent on both lanes as a hint (`structuredOutputHint`), and every answer is validated and re-asked. Image-only modality caps for now.

New registry fields and helpers:

- `structuredOutputHint` and `structuredWireMode(model)`: the wire field a structured call's schema goes in — the trusted `structuredOutputMode`, else the hint. Trust decisions keep reading `structuredOutputMode` alone. `llmSendsSchema(modelId, feature?)` says whether a structured call on a model sends its schema at all.
- `effortBelowLowestSendsLowest`: a requested effort below the model's lowest level is sent as that level rather than dropped (Kimi K3 and Kimi K3.1 Pro: `none` sends `low`; Auto still sends nothing). `effectiveReasoningEffort` follows it.
- `effortPriced` and the price key: on such a model `llmPriceKey` adds `:effort-<level>` naming the effort the call sends (`LLM_PRICE_KEY_EFFORT`; `LLM_PRICE_KEY_DIRECT` is `:direct`). Every other model's key is unchanged. `parseLlmPriceKeyModel` reads a key's model part back, and refuses any suffix no key carries.

No feature default, role or existing entry changes.
