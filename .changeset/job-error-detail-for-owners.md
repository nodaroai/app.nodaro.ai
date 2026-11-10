---
"@nodaro/sdk": minor
"@nodaro/shared": minor
---

A failed job now tells its owner what the provider itself said. `Job.error_detail` and `JobStatusResult.error_detail` carry the provider's own words for the failure (links cut to their host, secrets removed; `null` when the failure had no provider text), beside the platform's `error_message`; a failed node of a workflow run carries them as `errorDetail` on its `NodeExecutionStateWire` entry. Display them, and keep branching on `error_hint` / `errorCode`. `EXECUTION_DATA_KEYS` lists `errorDetail` as run state, so a saved preset never captures it.
