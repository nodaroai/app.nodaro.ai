---
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Favorites, ratings and filtered job lists. `client.jobs.list()` filters by `status` (one status or a list), by several `type`s at once, by your favorites (`favorited: true | false`) and by your rating (`rating: "good" | "bad" | "rated" | "unrated"`), all combined with AND; every `Job` it or `jobs.get()` returns carries `favorited` and `rating` (left out when the server cannot read them for a moment — treat a missing field as unknown, never as `false`). `client.jobs.rate(id, "good" | "bad" | null)` rates one of your jobs (`null` clears the rating). The new `client.gallery` resource browses the public gallery (`browse()`) and keeps your favorites: `toggleFavorite(jobId)` answers `{ favorited }`, `favorites()` your favorited job ids, newest first. New types: `JobRating`, `JobRatingFilter`, `RateJobResult`, `GalleryItem`, `GalleryMediaType`, `BrowseGalleryParams`, `GalleryPage`, `ToggleFavoriteResult`.

The CLI gains `nodaro jobs list` (the same filters; `--no-favorited` for the jobs you did not favorite), `nodaro jobs rate <id> good|bad|clear` and `nodaro gallery browse | favorite <jobId> | favorites` (`gallery browse --favorites` lists your own favorited items).

Existing calls are unchanged. An OAuth app needs `assets:write` to rate a job or toggle a favorite, and `assets:read` or `jobs:read` to list favorites; favoriting another person's private job is a `NotFoundError`. `browse({ favoritesOnly: true })` lists your own favorites only: pass your own `userId` — another person's favorites are refused.
