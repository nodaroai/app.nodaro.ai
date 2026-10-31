---
"@nodaro/sdk": minor
---

Jobs: `error_hint` may carry a new arm, `QueueTimeoutHint` (`{ kind: "queue-timeout", reason: "timeout" | "lost" | "live-wait", waitedMinutes }`), on a job that never got a concurrency slot and did not run (its credits are refunded). The type is exported from `@nodaro/sdk` and `@nodaro/sdk/jobs`. Treat an unknown `kind` as an unclassified failure, as before.
