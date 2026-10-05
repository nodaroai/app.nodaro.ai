---
"@nodaro/shared": minor
---

Text to Audio (`elevenlabs-sfx`) is priced per second of audio requested. Export `textToAudioCreditId(provider, duration)` — the price row a request is charged from (`elevenlabs-sfx:<n>s`, whole seconds rounded up, 1–30; no duration → `:5s`) — with `textToAudioBilledSeconds`, `TEXT_TO_AUDIO_SFX_CREDIT_IDS` and `TEXT_TO_AUDIO_PRICING`. The `elevenlabs-sfx` model-catalog entry now lists per-second pricing rows.
