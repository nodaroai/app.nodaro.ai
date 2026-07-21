---
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Generate Video Pro run control — `client.videoPro.stop(jobId)` (graceful stop: keep + deliver the completed segments as the final video, refund the untouched remainder; the in-flight segment is billed) and `client.videoPro.continueRun(jobId, { fromSegment? })` (a NEW job that reuses the delivered segments and regenerates from `fromSegment` on, billed only for the regenerated part; works on stopped, failed, and completed runs). CLI: `nodaro video-pro stop <jobId>` and `nodaro video-pro continue <jobId> [--from-segment N] [--watch]`.
