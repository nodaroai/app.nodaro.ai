---
"@nodaro/sdk": minor
---

`objects.list()`, `creatures.list()` and `locations.list()` (and their `listArchived` variants) now accept optional `limit` (cap 500) and `cursor` parameters and return `nextCursor`, mirroring `characters.list()`. Pagination is opt-in: omitting `limit` returns the full legacy listing with no `nextCursor`, exactly as before. Loop until `nextCursor` is `null` to read a library of any size.
