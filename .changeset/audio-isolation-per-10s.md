---
"@nodaro/shared": minor
---

Audio Isolation is priced by the length of its audio, as the server reads it before anything is held: one unit of the new row `elevenlabs-isolation:per-10s` per started 10 seconds, at least one, for audio up to 30 minutes. New exports from `@nodaro/shared/credits`: `audioIsolationUnits`, `checkAudioIsolationLength` (refuses audio past 30 minutes), `audioIsolationEstimateUnits` (an estimate quotes the 30-minute price when the length is not known), `audioIsolationTooLongMessage` and the `AUDIO_ISOLATION_*` constants. The `elevenlabs-isolation` catalog entry now lists the per-10-second row.
