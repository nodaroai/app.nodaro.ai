---
"@nodaro/sdk": minor
---

`client.videoRemake.sideBySide(jobId)` (`POST /v1/video-remake/:jobId/side-by-side`): a finished run's original clip and its result in one video, the result's sound, "Original" / "Remake" labels. Answers `{ status: "making" | "waiting" }` until the file is rendered, then `{ status: "ready", url, fileName, width, height, layout }`. New type `VideoRemakeSideBySide`.
