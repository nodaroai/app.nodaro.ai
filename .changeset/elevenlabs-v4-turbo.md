---
"@nodaro/shared": minor
---

Add the `elevenlabs-v4-turbo` text-to-speech model: a new `TTS_PROVIDERS` member and catalog entry — the faster, cheaper ElevenLabs v4 at lower fidelity (v4 wins on quality; Turbo is the budget tier), with audio tags, stability and similarity (no speed, style or SSML), the same 46 languages as v4, up to 10,000 characters per request — priced at Turbo v2.5's credit rows (15 flat; 2 per started 100 characters where length pricing is on). `elevenlabs-v4` stays the default; the narration recommendation lists v4 Turbo after v3. The `SharedVoice.recommendedProvider` / `verifiedProviders` doc comments (`GET /v1/voices/library`) now state the five-member order — `elevenlabs-v4`, `elevenlabs-v3`, `elevenlabs-v4-turbo`, `elevenlabs-turbo`, `elevenlabs-multilingual` — and that the exact id `eleven_v4_turbo` counts toward `elevenlabs-v4-turbo` (documentation only: no type or export changed).
