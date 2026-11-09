---
"@nodaro/shared": minor
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Speech: the audio file a run delivers, and favorite voices.

- `TextToSpeechParams` (`nodes.run("text-to-speech", …)`) takes `outputFormat`: `mp3_44100_128` (the default, as before), `mp3_44100_192` or `wav_24000` — same credits, the job's `audioUrl` ends in `.mp3` or `.wav` accordingly. The values are `TTS_OUTPUT_FORMATS` in `@nodaro/shared/models` (with `DEFAULT_TTS_OUTPUT_FORMAT` and `TTS_OUTPUT_FORMAT_FILES`). `withTimestamps` is now typed too.
- `client.voices.listFavorites()`, `favorite(input)` and `unfavorite(voiceId)`: the signed-in user's favorite voices — a premade voice, a Voice Library voice or one of their clones — starred from any client and read back by all of them, newest first, each with the `voiceId` / `voiceType` a speech run takes and the `name` / `previewUrl` it was starred with. Types `VoiceFavorite`, `VoiceFavoriteInput` and `VoiceFavoriteType` (its values as `VOICE_FAVORITE_TYPES`) in `@nodaro/shared/pipeline` and `@nodaro/sdk/voices`.
- `VOICE_LIBRARY_USE_CASES` / `VoiceLibraryUseCase` (`@nodaro/shared/pipeline`): the seven `use_cases` values `voices.searchLibrary()` groups the Voice Library by (`advertisement`, `characters_animation`, `conversational`, `entertainment_tv`, `informative_educational`, `narrative_story`, `social_media`); `VoiceLibraryParams.use_cases` is typed to them and still takes any string.
- CLI: `nodaro voice favorites`, `nodaro voice favorite <voiceId> --name … --type premade|library|custom [--preview <https url>]` (both options required), `nodaro voice unfavorite <voiceId>`.
