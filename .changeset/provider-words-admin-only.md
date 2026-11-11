---
"@nodaro/sdk": patch
"@nodaro/shared": patch
---

A deployment can keep a failed job's provider words for its administrators. There, `Job.error_detail` and `JobStatusResult.error_detail` are `null`, and a failed node's `errorDetail` is absent from its `NodeExecutionStateWire` entry, for every caller who is not an administrator, exactly as for a failure that had no provider text. The types are unchanged; their documentation now says so.
