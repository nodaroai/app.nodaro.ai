---
"@nodaro/shared": minor
---

A catalog model may be offered under the deployment's own label: `ModelCatalogEntry` now takes exactly one of `maker` (the company that made it, as before) or `ownLabel: true` (no maker). `ModelCatalogEntry` becomes a type alias over the new `ModelCatalogEntryFields` interface plus that choice, so `entry.maker` reads as `ModelMakerId | undefined`; `modelMakerOf` returns `undefined` for an own-label model. No catalog model uses `ownLabel` yet. If you read the catalog: narrow with `entry.ownLabel` or `entry.maker === undefined` before indexing `MODEL_MAKERS[entry.maker]`, and an `interface … extends ModelCatalogEntry` no longer compiles (use an intersection type, e.g. `ModelCatalogEntry & { … }`).
