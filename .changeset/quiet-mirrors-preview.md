---
"@nodaro/sdk": minor
---

Preview a studio operation batch before it lands: `studio.productions.ops(id, { …, dryRun: true })` returns typed receipts of what the batch WOULD do. The flag is proved on an empty batch first, so a deployment that predates the preview cannot silently apply the caller's batch — that case throws `StudioPreviewUnavailable` with nothing sent, and a batch applied anyway by a second deployment throws `StudioPreviewAppliedError` carrying the write.

Adds `client.copilot`: threads, and one assistant turn as a typed stream of frames. The package's SSE reading now lives in one shared reader, which `media.downloadVideoProgress` uses unchanged.
