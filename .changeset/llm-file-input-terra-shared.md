---
"@nodaro/shared": minor
---

LLM models that read documents. `LLM_MODALITY_CAPS` gains an optional `file` capability, declared on GPT-6.1 Terra alone (never derived for another model): it reads PDF files sent with the prompt. New exports from `@nodaro/shared/llm-models`: `llmAcceptsFiles(modelId)`, `LLM_FILE_MODELS`, the limits `LLM_REFERENCE_FILES_MAX` (5 files), `LLM_REFERENCE_FILES_MAX_TOTAL_BYTES` (6 MB in all), `LLM_REFERENCE_FILES_MAX_PAGES` (100 pages in all) and `LLM_REFERENCE_FILE_MIME_TYPES` (`application/pdf`), and the `LlmModalityCaps` type that `getLlmModalityCaps` now returns.
