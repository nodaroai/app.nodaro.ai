---
"@nodaro/sdk": minor
---

`Job` and `JobStatusResult` gain `error_hint?: JobErrorHint | null` — the worker's structured content-policy verdict (`{ kind: "safety-block", class: "copyright" | "likeness" | "safety", retried, suggestedProvider? }`), present on a job the worker classified as a final safety/content-policy block — and `credit_status?: "reserved" | "committed" | "refunded" | null`, the job's credit-reservation lifecycle derived server-side from `usage_logs.status`. Both are `null`/absent when not applicable; `credits` (the reserved amount) is unchanged.
