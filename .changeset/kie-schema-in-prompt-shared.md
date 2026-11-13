---
"@nodaro/shared": minor
---

`LlmModelDef.kieSchemaInPrompt`: the KIE lane sends a structured call on this model no `response_format` and carries the schema in the system prompt instead, in the wire form that field sent; the model's `structuredOutputMode`, its trust and its direct lane are unchanged, and the direct lane is asked once when a call's KIE answers never validate. Set on `gemini-3.8-flash` and `gemini-3.7-flash` (served by the same KIE endpoint), whose KIE endpoint fails any request that carries `response_format`. `llmSendsSchema` counts a schema sent either way.
