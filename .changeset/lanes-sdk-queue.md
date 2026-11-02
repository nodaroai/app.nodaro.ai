---
"@nodaro/sdk": minor
---

Jobs, workflow runs and pipelines that wait for a free concurrency slot now say where they stand in line. `Job`, `JobStatusResult`, `WorkflowExecution` and `PipelineRecord` gain an optional `queue` field (`JobQueueInfo`: `{ lane, position, limit, running, reason, waitedSeconds, upgradeHint }`), present only while the job or pipeline is `queued` (or the run waits for its turn, its status staying `pending`). `JobQueueInfo` is exported from `@nodaro/sdk` and `@nodaro/sdk/jobs`. Concurrency limits are not enforced in this release, so nothing waits for a slot yet and the field does not appear yet.

`nodes.runAndWait()`, `runMany()` and `runBatchAndWait()` no longer count the time a job spends waiting for a free slot (`queued`) toward `maxMs`, so waiting for a slot never uses up the wait. Every other status, `pending` included, counts as before. `BillingPlan.parallelism`'s description notes what it means once concurrency limits are enforced.
