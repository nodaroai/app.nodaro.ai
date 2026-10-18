---
"@nodaro/shared": minor
---

LLM catalog gains `gemini-4-argon` (`@nodaro/shared/llm-models`), premium tier, served ONLY on Google's own API: the new `directOnly` registry flag says a model has no aggregator lane (no primary, no fallback), and `llmServesDirect` is true for such a model on every call, so it always builds the direct credit rung (`<feature>:premium-direct`). Reasoning is `low | medium | high` — Google refuses its minimal level on this model, so `none` is not offered. It reasons with no effort sent (`thinkingDefaultOn`). Image-only modality caps by decision: the model reads video and audio, but it stays out of the video-analysis models until a Video Analysis bake-off decides its tier. It is the default of no feature.
