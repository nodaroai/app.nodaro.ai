---
"@nodaro/sdk": minor
---

`client.media.splitIntoLayers(input, options?)` takes per-call options: `idempotencyKey` (sent as the `Idempotency-Key` header, so a retry of the same request answers the job it already started, `deduped: true`, instead of starting and charging a second one), `signal` and `timeoutMs`. Its body, `SplitIntoLayersInput`, now takes `sessionId` (file the job in one of your sessions) and `origin` (your app's slug), as every job-creating request does. It resolves `MediaJobStarted` (`{ jobId, deduped? }`); the new `MediaRunOptions` and `MediaJobStarted` types are exported from `@nodaro/sdk` and `@nodaro/sdk/media`.

`client.nodes.quote` is typed for `"edit-image"` (`EditImageParams`), and the platform now quotes it for every edit model: Nodaro Image Upscale is quoted at the exact price of the picture it is sent, measured as the run measures it with nothing stored. `"split-into-layers"` is quotable with the same body as `splitIntoLayers`: its `reserve` is the hold, the most the run can cost. A `settles_to_actual` warning marks a `reserve` that is such a maximum; the new codes `output_size`, `max_images` and `image_size_unmeasured` are documented on `QuoteAdjustment` and `QuoteWarning`.
