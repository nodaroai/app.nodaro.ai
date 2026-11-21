---
"@nodaro/sdk": minor
---

`videoRemake.previews({ locale })` (`GET /v1/video-remake/previews`, public) lists the before-and-after previews Nodaro's pages show of what Video Remake does, in their order: each `{ id, kind, title, caption, sourceUrl, resultUrl, sweepUrl, stackedUrl, posterUrl, stackedPosterUrl, href }` (`VideoRemakePreview`, also from `@nodaro/sdk/video-remake`). `kind` is `restyle`, `motion`, `object`, `background` or `edit`; `title` and `caption` are in `locale` (English when left out, unknown, or without copy in that language); `sweepUrl` shows the original wiping into the result and `stackedUrl` the original above the result, with `posterUrl` and `stackedPosterUrl` still frames of each; `href` is a path on the Nodaro tools site. The list is empty on a deployment that does not show Nodaro's previews, or one without Video Remake. No sign-in needed; the answer may be up to five minutes old.
