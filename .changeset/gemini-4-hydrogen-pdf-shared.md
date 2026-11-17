---
"@nodaro/shared": minor
---

`gemini-4-hydrogen` now reads PDF files: its `LLM_MODALITY_CAPS` row gains `file: true`, so `llmAcceptsFiles("gemini-4-hydrogen")` is true and `LLM_FILE_MODELS` lists it beside `gpt-6.1-terra`. LLM Chat and `generate_text` take `referenceFileUrls` / `file_urls` on it, within the same limits (PDF only, up to 5 files, 6 MB and 100 pages in all).

New in `@nodaro/shared/llm-models`:

- `LlmModelDef.fileWire` (`LlmFileWire`): how a document is sent to a model on each lane that can serve it. Declared by exactly the models that read files.
- `llmFileWire(modelId)`: that declaration, or `undefined` for a model that reads no files.

The `file` cap is read by the LLM nodes only: it enrols the model in no other product. GPT-6.1 Terra's caps and behaviour are unchanged.
