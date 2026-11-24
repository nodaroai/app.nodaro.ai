---
"@nodaro/sdk": minor
---

Video Remake's upscale choice. `videoRemake.run()` and `estimate()` take `upscale: "off" | "next"`: `"next"` delivers the finished video upscaled to the next size (480p to 720p, 720p to 1080p). Left out, a run is upscaled where the choice is offered and not elsewhere. It is not offered on 1080p runs, drafts or trend runs, or where the deployment has not turned it on; a `"next"` sent there runs as `"off"`. The estimate now answers `resolution` (the engine's size), `outputResolution` (the size delivered), `upscale` (the choice the run would be made with), `upscaleOffered` and, on a `"next"` run, the price in `breakdown.upscale`. `styleChoice()` answers `upscaleChoice`, whether the deployment takes the choice at all. New types `VideoRemakeUpscaleChoice`, `VideoRemakeUpscaleOutcome` and `VideoRemakeJobOutput` (a completed job's `outputResolution`, and `upscale: "applied" | "skipped"` on a `"next"` run).
