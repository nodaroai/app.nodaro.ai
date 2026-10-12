---
"@nodaro/shared": minor
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Pitch & Tempo (`pitch-tempo`): shift pitch by semitones and change tempo without changing pitch (Rubber Band), on audio or video.

- `@nodaro/shared`: the per-minute pricing helpers (`PITCH_TEMPO_PRICING`, `PITCH_TEMPO_LIMITS`, `pitchTempoCreditId`, `pitchTempoStartedMinutes`, `parsePitchTempoCreditId`, `pitchTempoBaseCredits`, `semitonesToPitchRatio`); `pitch-tempo` joins `DYNAMIC_PRODUCER_TYPES` and `AUDIO_PRODUCER_TYPES`.
- `@nodaro/sdk`: `client.audio.pitchTempo({ audioUrl | videoUrl, semitones?, tempo?, preserveFormants? })` → `POST /v1/pitch-tempo`.
- `@nodaro/cli`: `nodaro audio pitch-tempo --audio <url>|--video <url> [--semitones] [--tempo] [--no-preserve-formants]`.
