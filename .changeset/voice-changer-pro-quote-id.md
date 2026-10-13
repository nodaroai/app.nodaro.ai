---
"@nodaro/shared": minor
---

A whole Voice Changer Pro convert as one price id: `voiceChangerProQuoteCreditId(slots)` names the exact price of a convert with these recast voices (`voice-changer-pro:<slot>,…` — `sts-<seconds>` per speech-to-speech voice, `respeak-<characters>` per Re-speak voice, the bare kind for an unknown measure), which `POST /v1/credits/model-costs` and `GET /v1/credits/model-cost` answer with the credits the convert reserves; `parseVoiceChangerProQuoteCreditId` reads one back. The convert is charged the sum of its voices, rounded once, so a client quotes that answer instead of adding up per-voice prices. A dub of N started minutes is quoted as `elevenlabs-dubbing:<N>u` (`unitQuoteCreditId`).
