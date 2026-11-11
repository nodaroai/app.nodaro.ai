---
"@nodaro/shared": minor
---

A masked GPT Image 2.6 Flare or Sunburst edit follows its photo. `normalizeModelInput` takes `context.masked`: on a model whose catalog entry sets `maskEditMatchesSource`, the run keeps the photo's shape ("auto", whatever ratio it names) and renders at the size of its new `outputSizes` table nearest the photo's long side, each change reported in `adjustments`; with the photo's size unknown the size asked is kept. `resolveNormalizedImageGen` takes `masked`. Adds `maskEditMatchesSource`, `sourceImageSizeNeeded`, `resolutionNearestSource` and `maskedEditResolution` (model catalog), and `wiredImageSize`, `recordedImageSize` and `nodeIsMasked` (workflow), for an estimate that knows the photo's size from the node it comes from.
