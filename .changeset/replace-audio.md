---
"@nodaro/sdk": minor
"@nodaro/shared": patch
---

Replace Audio (Nodaro Cloud): `@nodaro/sdk` adds `media.replaceAudio(input, options?)` — `POST /v1/replace-audio`, keep a video's speech and replace its music (or all its sound) as one job, the music a file or a prompt — with the `ReplaceAudioInput`, `ReplaceAudioOutput` and `ReplaceAudioRunStep` types. `@nodaro/shared` counts the `replace-audio` node among the video producers, so its output connects wherever a video goes.
