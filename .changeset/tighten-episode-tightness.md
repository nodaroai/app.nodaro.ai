---
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Tighten Episode takes `tightness` (`"light" | "standard" | "tight"`), how far long pauses are shortened: light shortens pauses over 600 ms to 350 ms, standard (the default) pauses over 350 ms to 220 ms, tight pauses over 250 ms to 150 ms. It is on `TightenEpisodeInput` (`client.edit.tightenEpisode` and `client.edit.estimateTightenEpisode`) and on `nodaro edit tighten-episode` as `--tightness`.
