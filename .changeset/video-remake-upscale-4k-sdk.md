---
"@nodaro/sdk": minor
---

Video Remake's upscale choice now reaches 4K: a 1080p run's next size is 4K, so `"next"` on a 1080p run delivers it at 4K where the choice is offered. The estimate's and a completed job's `outputResolution` can therefore be `"4k"` (lower-case); the engine's own size, `resolution`, stays 480p, 720p or 1080p. New type `VideoRemakeOutputResolution` (`"480p" | "720p" | "1080p" | "4k"`), used by `VideoRemakeEstimate.outputResolution` and `VideoRemakeJobOutput.outputResolution`. The estimate's `upscaleOffered` remains the authority on whether a run is offered the choice.
