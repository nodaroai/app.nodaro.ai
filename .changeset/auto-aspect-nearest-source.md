---
"@nodaro/shared": minor
---

`aspectRatio: "auto"` keeps the source photo's shape on models without a native auto. `normalizeModelInput` takes an optional third argument, `{ sourceImage: { width, height } }`: when the request asks for `"auto"`, the model's catalog ratios lack it and the source size is known, the result is the listed ratio nearest the source (`nearestCatalogAspectRatio`: log space, and on this source-size path a tie goes to the ratio listed first). Without a size the result is unchanged. `resolveNormalizedImageGen` accepts the same `sourceImage`. The ratio-token fit (`fitAspectRatioToModel`, used by `normalizeVideoRequestParams`) is unchanged. New exports: `nearestCatalogAspectRatio`, `autoAspectNeedsSourceImage`, `isAutoAspectToken`, `SOURCE_IMAGE_NODE_TYPES` and the `SourceImageSize` / `ModelInputContext` types. `normalizeNodeModelParams` now keeps `"auto"` on image-to-image, modify-image and edit-image nodes for the run to resolve against the source image.
