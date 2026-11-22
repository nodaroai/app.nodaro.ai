---
"@nodaro/sdk": patch
---

`LlmChatParams.referenceFileUrls` documents the models that read files now: GPT-6.1 Terra, GPT-6.2 Sol, GPT-6.2 Astra, Gemini 4 Hydrogen and Gemini 4 Neon. Gemini 4 Neon takes at most 10 attachments of any kind in one call (`400 too_many_attachments` above that).
