---
"@nodaro/sdk": minor
---

`client.trends` gains `getRun(jobId)` (`GET /v1/trends/runs/:jobId`: one of your trend runs, in the same shape as `runs()`; a job that is not your own trend run is a `NotFoundError`) and `tags({ locale? })` (`GET /v1/trends/tags`: the tags in use on published trends, most used first, as `TrendTag { tag, label, count }` with the label in your language). A Full Quality version of a draft is now listed as a run of its own: `TrendRun` gains `fullQualityOf` (the draft it was made from, else `null`); only the newest Full Quality try per draft is listed (running, done, or its last failure; an older failed or cancelled try is left out of `runs()`, and `getRun()` still reads it by its id); a draft's `fullQuality` becomes a pointer only to that newest try, `{ jobId, status } | null` (its `videoUrl` is gone — read the upgrade's video from its own run). `"tags"` joins `"runs"` as a slug the slug methods refuse before any request.
