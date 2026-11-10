---
"@nodaro/sdk": minor
---

`ModelSummary` (`client.models.list()`) types the fields `GET /v1/models` now serves on a model whose sizes depend on its aspect ratio or its background: `resolutionsByAspectRatio` (the ratios at which the model renders fewer sizes than `resolutions`, each with the sizes it renders there; a ratio not listed renders every size — GPT Image 2.5 renders 27:16, 16:27, 9:8 and 8:9 at 1K only), `transparentResolution` (the one size a transparent background renders at) and `backgroundOnlyAtTransparentResolution` (the model takes a background setting at that size only). It also types `defaultDuration` and `autoDuration`, which the endpoint already served.
