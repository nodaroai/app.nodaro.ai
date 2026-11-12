---
"@nodaro/shared": minor
---

Grok Imagine Video 1.5 takes a start frame only at 1080p.

- New catalog field `startFrameOnlyResolutions` names the resolutions at which a video model takes a start frame only: no end frame, loop or in-between frames. `grok-imagine-video-1.5` declares `["1080p"]`.
- New `videoStartFrameOnlyProblem(provider, { resolution, durationSec, hasEndFrame, inBetweenFrameCount, nothingCharged })` answers whether a run is refused for that, and with what sentence. In-between frames are counted after the clip's cap (`videoKeyframesMiddleCap`), so a run whose extra frames are all dropped is a start-only run. A loop counts as an end frame.
- Also new: `VIDEO_START_FRAME_ONLY_CODE` (`"start_frame_only_resolution"`), `videoStartFrameOnlyResolution()` and `videoStartFrameOnlyMessage()`.
