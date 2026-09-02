---
"@nodaro/sdk": minor
---

`client.llm.structured(body)` / `client.llm.structuredJob(body)` — the forced-schema LLM call, typed, and its asynchronous twin (`POST /v1/llm/structured/jobs`: `{ jobId }` at once; optional `label`, and `videoUrl` + `videoAnalysis` to draft from a video's analysis). `client.jobs.list({ type, origin, limit, cursor })` — your jobs, filtered on `input_data.type` / `.origin`, cursor-paginated. `client.media.process(input)` — the free, synchronous cut/crop (`POST /v1/media/process`).
