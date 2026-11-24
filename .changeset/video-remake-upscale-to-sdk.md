---
"@nodaro/sdk": minor
---

`videoRemake.styleChoice()` now answers `upscaleTo`: per engine (or Flash choice) and the engine's size, the size the upscale choice's `"next"` delivers on this deployment (for example `{ "nodaro-prism": { "480p": "720p", "720p": "1080p", "1080p": "4k" } }`), so a page can show its Upscale control before a clip is added. A size or engine missing from it is not offered; it is `{}` where `upscaleChoice` is false, and absent from an older server. New type `VideoRemakeUpscaleTo`. The estimate's `upscaleOffered` stays the authority for an actual run.

`VideoRemakeJobOutput` now types `engineVideoUrl`, `engineWidth` and `engineHeight`: on a run whose upscale was applied, the engine's own version of the video at the engine's size, beside the upscaled `videoUrl`.
