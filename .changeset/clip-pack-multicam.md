---
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

`client.edit.clipPack` and `client.edit.estimateClipPack` take the recordings of one conversation, as Tighten Episode and Trailer do: `ClipPackInput` extends `UseCaseRecordingsInput` — `mediaUrls` (in order, instead of `mediaUrl`), an optional `masterAudioUrl` and the `cameras` settings (`{ wide, synced, speakerCameras }`); each clip then cuts to whoever is talking. Its `mediaUrl` is now optional; existing calls send the same body. Passing both `mediaUrl` and `mediaUrls`, or neither, rejects with a `TypeError` before any request. Several recordings or a Master audio need Speaker Map: where it is not available to the caller, the request is refused `403 node_not_available`. `ClipPackInput.framingSource` (`"auto" | "static" | "tracking"`) picks how a framed pack follows its speakers: `"tracking"` runs Speaker Frames once over the whole pack.

`nodaro edit clip-pack` takes the same recordings flags as `edit tighten-episode`: repeat `--media` for the cameras of one conversation (in order), `--master-audio <url>`, and `--wide-camera <n>`, `--synced` and `--speaker-camera <speaker>=<recording>` (repeatable; 0 = the wide shot), and `--framing-source <auto|static|tracking>` (not with `--framing none`). One `--media` sends the one-recording request as before.
