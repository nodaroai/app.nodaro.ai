---
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

A generation session's cover: `sessions.update(id, { coverJobId })` picks one of the session's items to lead its previews (`null` goes back to automatic), and `GenerationSession.coverJobId` reports it — `previewUrls` then starts with the cover's image. The CLI's `nodaro sessions update` gains `--cover <jobId>` and `--auto-cover`.
