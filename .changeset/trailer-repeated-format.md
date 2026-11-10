---
"@nodaro/sdk": patch
---

`EpisodeTrailerInput.formats`: a list that names a format twice is now refused by the server (`400 validation_error`, naming the format: "The format 9:16 is listed twice: name each format once.") before anything is written or charged, on `episodeTrailer` and `estimateEpisodeTrailer` alike. It used to be accepted and each format delivered once.
