---
"@nodaro/shared": minor
---

`queueInfo` joins `EXECUTION_DATA_KEYS` and `TRANSIENT_RUNTIME_KEYS`: the editor keeps where a node's job stands in line while it waits for a free concurrency slot under this key. It is run state, so it never marks a workflow as changed and is never saved with it. Concurrency limits are not enforced in this release, so nothing waits for a slot yet and the key is never written yet.

`NodeExecutionStateWire` declares two optional keys a single-node job's node state carries while its job waits for a free concurrency slot: `queued` (`true`) and `waitedSeconds` (whole seconds waited, counted from when it first started waiting). They are present only while the job waits, so they do not appear yet either.
