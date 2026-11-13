---
"@nodaro/sdk": minor
---

`nodes.run("llm-chat", params)` is typed: `LlmChatParams` (from `@nodaro/sdk/nodes`), including `referenceFileUrls` — up to 5 public links to PDF documents a model that reads files (GPT-6.1 Terra) reads with the prompt. A file on another model, or one that is not a PDF, cannot be read or is past a limit, answers `400` before any credits are held.
