---
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

`client.edit.tightenEpisode` and `client.edit.estimateTightenEpisode` take the recordings of one conversation: `mediaUrls` (in order, instead of `mediaUrl`), an optional `masterAudioUrl` and the `cameras` settings (`{ wide, synced, speakerCameras }`) — the new `UseCaseRecordingsInput`, merged into `TightenEpisodeInput` (its `mediaUrl` is now optional; existing calls are unchanged). Passing both `mediaUrl` and `mediaUrls`, or neither, rejects with a `TypeError` before any request. Several recordings or a Master audio need Speaker Map: where it is not available to the caller, the request is refused `403 node_not_available`.

`nodaro edit tighten-episode` takes the same: repeat `--media` for the cameras of one conversation (in order), `--master-audio <url>`, and the Cameras flags `--wide-camera <n>`, `--synced` and `--speaker-camera <speaker>=<recording>` (repeatable; 0 = the wide shot). One `--media` sends the one-recording request as before; a Cameras flag without several recordings or a Master audio, or a malformed one, exits 1 before any request.
