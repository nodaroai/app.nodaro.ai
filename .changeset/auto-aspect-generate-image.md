---
"@nodaro/shared": minor
---

Generate Image's "auto" keeps a wired photo's shape too. `normalizeNodeModelParams` now keeps `aspectRatio: "auto"` on generate-image nodes whose model — or the i2i sibling references swap it to — has no native auto (new `AUTO_ASPECT_AT_RUN_NODE_TYPES`: the source-image types plus generate-image), so the run can resolve it against the photo it sends; with no photo the run snaps it exactly as the write boundary did before. New exports: `normalizedImageGenModelId` — the catalog model `resolveNormalizedImageGen` snaps against (the i2i sibling once references attach), now also used inside it — and `imageGenAutoAspectNeedsSourceImage`, whether "auto" on a Generate Image request can need its photo's size (asked about that model with the assembled reference count, or about both the provider and its sibling when the count is not known yet).
