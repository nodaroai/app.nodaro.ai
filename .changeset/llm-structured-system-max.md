---
"@nodaro/shared": minor
"@nodaro/sdk": patch
---

Add `LLM_STRUCTURED_SYSTEM_MAX` (200,000): the `system` prompt of `POST /v1/llm/structured` and `POST /v1/llm/structured/jobs` now takes up to 200,000 characters, twice `LLM_TEXT_INPUT_MAX`, so a client whose schema writes in its own vocabulary has room for that vocabulary to grow. `input` stays at 100,000. The SDK's `LlmStructuredInput.system` doc states the new limit.
