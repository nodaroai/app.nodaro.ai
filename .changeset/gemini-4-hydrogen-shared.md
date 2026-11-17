---
"@nodaro/shared": minor
---

LLM catalog gains `gemini-4-hydrogen` (`@nodaro/shared/llm-models`): Gemini 4 Hydrogen, premium, vendor `google`, a fast multimodal Gemini 4 with a 1M-token context, taking text and image input.

- Reasoning `low | medium | high | xhigh` on both lanes, and it reasons by default. There is no `none` level: a `none` request runs at Auto, and `max` runs at `xhigh`.
- Served on the aggregator first, with Google's own API as its fallback and under Advanced mode.
- It has no trusted structured-output mode, so it is not a `STRUCTURED_VISION_MODELS` member. Its schema is still sent on both lanes as a hint (`structuredOutputHint`), and every answer is validated and re-asked.
- Image-only modality caps for now; it is not a video-analysis model.

New registry field `directXhighThinking`: the model's own Google API takes thinking level `XHIGH`, so an `xhigh` effort on that lane is sent as `XHIGH`. Every other Gemini model still sends `HIGH` for `xhigh` and `max`.

No feature default, role or existing entry changes.
