---
"@nodaro/sdk": minor
"@nodaro/cli": patch
---

`nodes.run("text-to-speech", …)` and `runAndWait` are typed (`TextToSpeechParams`) and take `previousText` / `nextText` — the lines spoken just before and after the clip, so a model that stitches (ElevenLabs v4, Turbo v2.5 and Multilingual v2; not v3) keeps one continuous intonation across clips produced separately. Up to 1,000 characters each. The CLI's `nodes run` help shows the two parameters.
