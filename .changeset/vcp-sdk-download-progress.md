---
"@nodaro/sdk": minor
---

`client.media.downloadVideoProgress(downloadId)` — stream a `downloadVideo` import's live progress (server-sent events) as an async iterable of `{ phase, percent, videoUrl?, thumbnailUrl?, error? }` events, ending after `completed`/`failed`. New exported `DownloadVideoProgress` type; `AudioFxPreset` is now re-exported from the package root (it types `voiceFx.preset` / `applyFx.preset`).
