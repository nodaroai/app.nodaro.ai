---
"@nodaro/sdk": minor
---

`err.code` on a 403, 404 or 429 error now carries the server's own code — for example `node_not_available`, `insufficient_scope`, `continuation_not_found` or `rate_limit_exceeded` — as every other status already did. Before, a `ForbiddenError`, `NotFoundError` or `RateLimitedError` always read `forbidden`, `not_found` or `rate_limited`, whatever the server sent. The classes, their messages and `ForbiddenError.missingScope` are unchanged, and `code` still reads `forbidden`, `not_found` or `rate_limited` when the server sends no code. Code that compares `err.code` with `forbidden`, `not_found` or `rate_limited` should compare the error class instead (`err instanceof ForbiddenError`, `NotFoundError`, `RateLimitedError`); code that already checks the class needs no change.
