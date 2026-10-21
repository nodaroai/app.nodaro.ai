---
"@nodaro/sdk": patch
---

`client.jobs.cancel(id)`: `CancelJobResult` now types the `inFlight?: boolean` the server already returns. Its JSDoc (and `cancelOnAbort`'s) states how a metered LLM job is cancelled. If its call has started, the cancel answers `{ success: true, cancelled: 0, inFlight: true }`, and the job finishes and is charged only what it used. If it is stopped before its call starts, it is refunded, except for what an earlier attempt of the same job already used (a retry after a billed attempt), which is charged. A synchronous metered LLM request cancelled before its call is sent answers `409 job_cancelled`; one whose call start cannot be recorded answers `503 job_start_failed`. Neither is charged. Both arrive as a `NodaroError` with that `code`.
