---
"@nodaro/shared": minor
---

A speech model's capability sheet now says whether it returns timings (`timestamps`), read through `ttsSupportsTimestamps` and `dialogueSupportsTimestamps`. All six ElevenLabs speech models do (measured 2026-10-06: each answers `/with-timestamps` at the same character cost as the plain call). A dialogue run carries a `transcript` on its job output; a text-to-speech run does when the request asks (`withTimestamps`).
