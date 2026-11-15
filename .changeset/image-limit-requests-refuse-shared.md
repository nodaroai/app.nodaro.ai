---
"@nodaro/shared": minor
---

A request over a model's image limit is refused on every model with a request image limit of its own, and a workflow run keeps its documented trim. `hasOwnRequestImageLimit(model)` says whether a model has such a limit (Seedream 5.5, GPT Image 2.6 Flare and Sunburst, MiniMax H3 Image, FLUX 3 Klein; a text-to-image id reads its edit model's). `refusesImagesOverLimitOn(model, run)`, with `run` an `ImageRunKind` (`"request"` or `"workflow"`), says whether that kind of run is refused past the limit rather than having images left out: a request on every model with its own limit, a workflow run only on a model whose catalog entry carries `refusesImagesOverLimit` (FLUX 3 Klein). Every model held to the default limit is unchanged. All three are exported from `@nodaro/shared/models`.
