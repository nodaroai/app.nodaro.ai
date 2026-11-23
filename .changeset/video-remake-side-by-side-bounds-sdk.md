---
"@nodaro/sdk": patch
---

`client.videoRemake.sideBySide(jobId)`: each half is the result's size up to a 1080p picture's pixels (a 4K result is scaled down, its shape kept; `width` / `height` are the file's). A developer app's token needs `jobs:read` and a `:write` or `:execute` scope (403 `insufficient_scope`).
