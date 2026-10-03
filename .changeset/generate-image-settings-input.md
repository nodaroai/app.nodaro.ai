---
"@nodaro/shared": minor
---

Generate Image takes the Aspect Ratio and Provider nodes through its `settings` input.

- `SETTINGS_INPUT_CONSUMERS["generate-image"]` accepts `aspect-ratio` and `provider` (no duration on a still), and `NODE_MAPPABLE_FIELDS["generate-image"]` lists `aspectRatio` and `provider`. A wired Provider must name an image model, and it replaces the node's `providers` list with that one model, so a node set to several models runs once.
- `fitAspectRatioToModel(modelId, ratio)` returns the ratio a model renders: the catalog's own spelling of a listed ratio, else the nearest listed one (log space). `normalizeVideoRequestParams` now uses it, so its answers are unchanged.
- `withWiredSettings(node, nodes, edges)` returns a node as it runs (its Settings input applied), for callers that plan or price a run before resolving it.
