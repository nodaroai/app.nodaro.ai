---
"@nodaro/shared": minor
---

`gemini-4-hydrogen` now reads video and audio (`LLM_MODALITY_CAPS`: `{ image: true, video: true, audio: true }`), so LLM Chat and `generate_text` take video and audio references on it.

Its media caps are for the LLM nodes only. New exports in `@nodaro/shared/llm-models`:

- `LLM_NODE_ONLY_MEDIA_MODELS`: the models whose video and audio caps enrol them in no other product. Today it lists `gemini-4-hydrogen`.
- `readsMediaOnLlmNodesOnly(modelId)`: whether a model is in that list.
- `readsVideoOutsideLlmNodes(modelId)` and `readsAudioOutsideLlmNodes(modelId)`: whether a model reads video (or audio) for a product other than the LLM nodes — its cap, less that list. A product that derives "the models that read video" asks these instead of the caps table.

`VIDEO_ANALYSIS_LLM_MODELS` leaves those models out, so Gemini 4 Hydrogen is not a video-analysis model. No tier, price or stored `llmModel` passthrough reaches it. Every other model's caps and video-analysis membership are unchanged.
