---
"@nodaro/sdk": minor
---

Voice adjacent ops on `client.voices`, bringing the SDK to parity with the MCP surface: adds `design()` (`POST /v1/voice-design`), `remix()` (`POST /v1/voice-remix`), `dub()` (`POST /v1/dubbing`), and `createCloneFromFile()` (`POST /v1/voice-clones`, multipart — the file counterpart to `createClone` from a URL). Also fills a param gap on the single-voice `change()`: `model`, `useSpeakerBoost`, and `seed` are now accepted (the backend already supported them). New exported types: `VoiceDesignInput`, `VoiceRemixInput`, `DubbingInput`. README `client.voices` summary corrected to reflect the full surface.
