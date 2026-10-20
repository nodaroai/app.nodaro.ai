---
"@nodaro/shared": minor
---

`ScheduleRetry` — the Schedule Trigger's "Retry on failure" policy (`afterMinutes`, `maxAttempts`, `cheapLanesOnly` — the latter keeps the run's model calls that honour it off the direct-vendor fallback), with `normalizeScheduleRetry`, `SCHEDULE_RETRY_LIMITS` and `SCHEDULE_RETRY_DEFAULTS`, exported from `@nodaro/shared/workflow`. A schedule trigger's `config.retry` (the triggers API) and the node's `data.retry` carry it.
