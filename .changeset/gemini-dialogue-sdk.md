---
"@nodaro/sdk": minor
---

`voices.textToDialogue` takes Google's Gemini speech models as `provider` (`gemini-3-8-flash-lite-tts`, `gemini-3-8-flash-tts`, `gemini-3-1-flash-tts`, `gemini-2-5-pro-tts`) for a dialogue of one or two speakers, each line's `voice` one of the model's own named voices (a `400` otherwise, before anything is charged). New optional fields: a line's `styleDirection` (3.8: how that line is spoken), `speakers` (3.1 / 2.5: each voice's style, pace, accent and audio profile) and `fillerWords` (3.8, two speakers). ElevenLabs Dialogue v3 stays the default. `outputFormat` picks the file on a Gemini model, as on `textToSpeech`: `mp3_44100_128` (the default), `mp3_44100_192` or `wav_24000`, at the same credits; the ElevenLabs dialogue models deliver the default MP3 only. For ElevenLabs dialogue callers: a non-default `outputFormat`, or a malformed or duplicated `speakers` entry, is now a `400` naming the field, where it was dropped before.
