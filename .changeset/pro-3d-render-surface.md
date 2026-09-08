---
"@nodaro/shared": minor
"@nodaro/sdk": minor
---

Add the `pro-3d-render` ("3D Render Pro") wire contract and SDK surface.

Generate/Edit 3D Scene share an authoring-engine resolver so connected retained
scenes use Advanced consistently on the canvas and in headless workflows. The
output presentation helpers also classify Pro as a video producer while keeping
its separate composition output.

`@nodaro/shared` gains the node type, the strict discriminated `source` union
(`prompt` / `scene` / `local-export`), the engine, quality, style, aspect-ratio
(including `21:9`) and correction-budget vocabularies, the request bounds, the
`Pro3DRenderQuote` and `Pro3DRenderCapabilities` shapes, the full
`Pro3DRenderJobOutput` reader schema (video + composition + revision, poster,
validation, renderer and metadata), and the shared `buildPro3DRenderSource` /
`pro3DRenderTimingOverrides` helpers both execution engines use so an in-browser
run and a headless one mean the same thing. `pro-3d-render` also joins
`COMPOSER_PLAN_MAP` (so a stored composition re-renders through the existing
`render-video` lane) and `VIDEO_PRODUCER_TYPES` (so its video output connects
downstream), and `ASPECT_RATIO_DIMENSIONS` gains `21:9` (1680x720).

`@nodaro/sdk` gains `scene3d.quotePro()` / `scene3d.runPro()` /
`scene3d.renderProAndWait()`, typed `nodes.run` / `runAndWait` overloads for the
node, per-call `Idempotency-Key` plumbing on `nodes.run`/`runAndWait`, and
`capabilities().pro` for discovering which engines, quality profiles, styles and
aspect ratios a deployment can serve. Additive apart from the new options
parameter: no existing method, type or route changes.
