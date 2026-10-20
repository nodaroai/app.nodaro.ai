---
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

`client.edit.episodeTrailer` and `client.edit.estimateEpisodeTrailer` take the recordings of one conversation, as Tighten Episode does: `EpisodeTrailerInput` extends `UseCaseRecordingsInput` — `mediaUrls` (in order, instead of `mediaUrl`), an optional `masterAudioUrl` and the `cameras` settings (`{ wide, synced, speakerCameras }`). Its `mediaUrl` is now optional; existing calls send the same body. Passing both `mediaUrl` and `mediaUrls`, or neither, rejects with a `TypeError` before any request. Several recordings or a Master audio need Speaker Map: where it is not available to the caller, the request is refused `403 node_not_available`.

`nodaro edit episode-trailer` takes the same flags as `edit tighten-episode`: repeat `--media` for the cameras of one conversation (in order), `--master-audio <url>`, and `--wide-camera <n>`, `--synced` and `--speaker-camera <speaker>=<recording>` (repeatable; 0 = the wide shot). One `--media` sends the one-recording request as before; a Cameras flag without several recordings or a Master audio exits 1 before any request.
