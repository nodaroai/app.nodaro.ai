---
"@nodaro/shared": minor
---

Add a per-model capability sheet for speech models: `ModelCatalogEntry.tts` (the `TtsCapabilities` and `TtsSettingLever` types) and the text-to-speech lookups `getTtsCapabilities`, `canonicalTtsProvider`, `ttsSupportsAudioTags`, `ttsSupportsSsmlBreaks`, `ttsHasLever` and `ttsLanguageCodes`, with the `TTS_PROVIDER_ALIASES` table (the legacy `elevenlabs` id runs as `elevenlabs-turbo`) and `TTS_FALLBACK_PROVIDER` they resolve through. `MAX_TTS_CHARS_BY_PROVIDER` now derives from the sheets (same keys and values; the keys follow catalog order) and `getMaxTtsChars` ignores inherited object member names; every cap it had is unchanged.
