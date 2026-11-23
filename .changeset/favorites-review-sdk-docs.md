---
"@nodaro/sdk": patch
---

Favorites documentation: `client.favorites.list()` can return a page with fewer items than `limit`, even none, while `nextCursor` is set — page on `nextCursor` until it is `null`. `client.library.list({ favorited })` and `client.library.favorite()` describe the Trash rule (a job's favorite counts while the job is out of the Trash; a file whose job is in the Trash has its own star) and that sending the wanted state is idempotent. `client.favorites.addCatalog()` notes the cap of 1000 favorite options.
