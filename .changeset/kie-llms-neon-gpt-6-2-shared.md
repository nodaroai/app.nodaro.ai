---
"@nodaro/shared": minor
---

LLM catalog gains three models (`@nodaro/shared/llm-models`):

- `gemini-4-neon` — Gemini 4 Neon, premium, vendor `google`, between Gemini 4 Hydrogen and Gemini 4 Carbon. Served on the aggregator only (no `directGeminiModel`, so no Advanced mode). Reasoning `low | medium | high | xhigh`, and it reasons by default (`none` runs at Auto, `max` at `xhigh`). It takes no temperature. It has no trusted structured-output mode, so it is not a `STRUCTURED_VISION_MODELS` member; its schema is sent as a hint (`structuredOutputHint`) and every answer is validated and re-asked. It reads images, video, audio and PDF (`file`) on the LLM nodes only (`LLM_NODE_ONLY_MEDIA_MODELS`), with `fileWire: { kie: "image-url" }`.
- `gpt-6.2-sol` — GPT-6.2 Sol, premium, listed directly above `gpt-6.1-sol`.
- `gpt-6.2-astra` — GPT-6.2 Astra, premium, the flagship GPT, listed directly above `gpt-6-astra`.

Both GPT-6.2 models take reasoning `low | medium | high | xhigh | max` (no `none`), reason by default, take no temperature, return enforced structured output (`responses-json-schema`) and read images and PDF files (`fileWire: { kie: "input-file" }`).

New registry field `maxAttachments` and helper `llmMaxAttachments(modelId)`: the most attachments (images, videos, audio clips and documents together) one call to a model may carry, where its provider documents a limit. Only `gemini-4-neon` declares one (10).

Descriptions: `gpt-6-astra` now reads "Previous flagship GPT-6, deep reasoning" and `gpt-6.1-sol` "Previous GPT-6 Sol, thorough but slower". No feature default, role or tier of an existing entry changes.
