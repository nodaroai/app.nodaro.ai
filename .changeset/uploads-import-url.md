---
"@nodaro/sdk": minor
---

`uploads.importUrl(url)`: copy a picture from a web address into your storage; `StorageExceededError.reason` carries the platform's code for a 413 (`file_too_large` is one file over the limit, not a full storage).
