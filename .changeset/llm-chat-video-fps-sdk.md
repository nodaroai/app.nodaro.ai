---
"@nodaro/sdk": minor
---

`LlmChatParams` (`nodes.run("llm-chat", …)`, `POST /v1/llm-chat/generate`) gains `referenceVideoFps`: the frames sampled per second of each reference video (above 0, up to 24; a model reads 1 frame per second when it is left out). It needs `advancedMode: true` on a Gemini model, because only the provider's own API carries a sampling rate; without it the call answers `400 video_fps_needs_advanced_mode`. More frames are more input tokens, charged at the model's rate as the rest of the prompt is.
