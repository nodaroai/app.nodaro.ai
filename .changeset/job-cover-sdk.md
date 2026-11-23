---
"@nodaro/sdk": minor
---

`jobs.update(id, { title?, cover? })` changes one of your results — its name, its cover picture, or both — on any kind of result (a song, a speech take, a sound effect, a video, an image, a dubbing, a Remake run). `cover` is one of your images on Nodaro, `{ assetId }` or `{ url }` (`JobCoverInput`), or `null` to clear it; PNG, JPEG, WebP or GIF, at most 10 MB, 64–8192 pixels on each side. `jobs.rename` keeps working. New `coverUrl` on `Job`, `SharedJob` and `LibraryAsset`: the owner's cover, else the provider's art (a Suno song's), else `null` — the one picture to show for a result.
