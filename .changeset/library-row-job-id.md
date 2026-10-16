---
"@nodaro/sdk": patch
---

Library rows carry the originating `jobId` when known: `LibraryAsset.jobId` (optional, `string | null`) on `client.library.list()` results names the job that made the file, `null` for an upload or once that job's history was deleted. A client app can go from a generation's job id to its stored file without comparing URLs. Nothing to change in an existing app; the field is absent when talking to a server from before it.
