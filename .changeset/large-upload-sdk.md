---
"@nodaro/sdk": minor
---

`uploads.uploadLarge(file, { filename, onProgress, signal, concurrency })` uploads a file of any size, choosing the lane by size. A file of `UPLOAD_MAX_BYTES` (500 MB, `POST /v1/upload`'s limit, now exported) or less goes through `uploads.upload` exactly as today. Only a bigger video or audio file goes straight to the platform's storage in parts (`POST /v1/uploads/large/start`, one `PUT` per part, `POST /v1/uploads/large/complete`). That large lane is limited by length instead of size: a file longer than 30 minutes rejects with the new `MediaTooLongError` (HTTP 422 `media_too_long`). Parts go three at a time by default, a failed part is tried twice more, and a failure or cancel aborts the upload. A file over 500 MB on a server without the lane (409 `large_upload_unavailable`, or 404 on an older server) throws the new `LargeUploadUnavailableError`.
