---
"@nodaro/shared": minor
---

Voice Changer is priced by the length of its audio, as the server reads it before anything is held (a video's sound when the run is given a video): one unit of the new row `elevenlabs-voice-changer:per-10s` per started 10 seconds, at least one, for audio up to 5 minutes. New exports from `@nodaro/shared/credits`: `voiceChangerUnits`, `checkVoiceChangerLength` (refuses audio past 5 minutes), `voiceChangerEstimateUnits` (an estimate quotes the 5-minute price when the length is not known), `voiceChangerTooLongMessage` and the `VOICE_CHANGER_*` constants. The `elevenlabs-voice-changer` catalog entry now lists the per-10-second row; the flat `elevenlabs-voice-changer` row is unchanged.
