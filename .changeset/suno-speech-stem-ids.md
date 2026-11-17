---
"@nodaro/shared": minor
---

Suno Speech and Suno stem ids (`@nodaro/shared/models`). The new `suno-speech` node is an audio producer (its row in the unit contracts). Suno Separate's output now names the Suno ids of its stems: `SUNO_SEPARATE_ID_FIELDS` lists `sunoTaskId` (the separation's task) and `sunoStemIds` (each stem's or take's own id, by its result field), and `sunoSeparateHandleField` / `sunoSeparateHandleIds` give the result field and the `{ taskId, audioId }` pair behind a handle — what Suno Convert to WAV takes a stem by. A run that Demucs or the connected cloud delivered carries no stem ids.
