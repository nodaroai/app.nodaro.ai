---
"@nodaro/shared": minor
---

Model catalog: two new video feature flags. `voice-references` marks a model that takes each reference audio clip as a voice sample and makes its own sound (Kling 4.0). `audio-soundtrack` marks a model whose first reference audio clip the platform plays as the result's soundtrack, sent as a sound-carrying reference video (Kling 4.0, on by default). New helpers: `audioSoundtrackActive`, `audioSoundtrackClipSec`, `audioSoundtrackPrompt`, `AUDIO_SOUNDTRACK_MIN_SEC`.
