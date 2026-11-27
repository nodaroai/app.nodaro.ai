---
"@nodaro/sdk": minor
---

Video Remake Full Quality: `VideoRemakeFullQualityEstimate.breakdown` no longer types an `upscale` part. The step that makes a render larger is never a line of its own: its credits are part of the 1080p render's line (`motionHd`), and `totalCredits` is unchanged. Code that reads `breakdown.upscale` no longer type-checks: read `totalCredits` and the parts that remain. An older server may still answer the line until it is updated; it stays readable through the breakdown's open record type. `VideoRemakeFullQualityEstimate` gains `renderReused?: boolean`: whether an earlier try's 1080p render is reused, so only the finishing is charged. Read it rather than `breakdown.motionHd === 0`, which no longer says it once the render's line carries the step; an older server leaves it out, and its `motionHd` 0 still means the render is reused.
