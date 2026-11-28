---
"@nodaro/sdk": minor
---

Video Remake: a Quality choice beside `resolution`. `VideoRemakeParams.quality` takes `"economy"` (the default: rendered one size below, then upscaled to the size delivered) or `"full"` (rendered at the size delivered, no upscale step, costs more); the new `VideoRemakeQuality` type names the two. Call `estimate()` once per value to price each. For a request that names `quality`, `VideoRemakeEstimate` gains `quality` (how this quote is made), `qualityOffered` (both ways exist for this request) and `engineResolution` (economy: the size rendered before the upscale), and `VideoRemakeJobOutput` gains `quality` and, on an Economy run whose upscale was applied, `engineVideoUrl`, `engineWidth`, `engineHeight` and `engineResolution`: the video before the upscale. `VideoRemakeStyleChoice.quality` lists, per engine choice, the sizes where the choice exists. A request that names no `quality` is sent and answered exactly as before.
