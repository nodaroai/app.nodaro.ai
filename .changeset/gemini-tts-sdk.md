---
"@nodaro/sdk": minor
---

`TextToSpeechParams` takes Google's Gemini speech models as `provider` (`gemini-3-8-flash-lite-tts`, `gemini-3-8-flash-tts`, `gemini-3-1-flash-tts`, `gemini-2-5-pro-tts`) and their style direction: `styleDirection` (free text on 3.8; one of the model's styles on 3.1 / 2.5), `pace`, `accent` and `audioProfile` (3.1 / 2.5). A Gemini model speaks only its own named voices: `voice` must be one of them (a `400` otherwise, before anything is charged), and none runs the model's default. `voices.list({ model })` answers a Gemini model's voices (the premade list as before without `model`, or with an ElevenLabs one).
