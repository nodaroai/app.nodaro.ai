---
"@nodaro/shared": patch
---

`EXECUTION_DATA_KEYS` and `TRANSIENT_RUNTIME_KEYS` list `jobConnectionLost`. The editor sets it on a node while it cannot reach the server to read that node's job. The job keeps running, and the flag clears on the next status check that gets through. Like `jobAwaitingReview`, it is run state: never saved with the workflow, captured in a preset, or recorded in undo history.
