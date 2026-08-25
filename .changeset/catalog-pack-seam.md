---
"@nodaro/prompts": minor
"@nodaro/shared": minor
---

Catalog replacement/extend pack seam. `@nodaro/prompts` gains a vendored catalog-pack registry (`registerCatalogPack` with `replace`/`extend`/`deny` modes) composed at the picker-catalog root — `getRegisteredPickerCatalogs()` is the single funnel every enumerating consumer reads (funnel getters, `projectAllCatalogs`, completeness). The base `PICKER_CATALOGS` is frozen and never mutated in place; curation is additive-by-registration. Also adds pack sidecar-coverage reporting (`computePackSidecarCoverage`) and a single-dim promptHint fallback so pack-added ids resolve.

`@nodaro/shared` gains exactly one thing: the tag-free `ProjectedCatalog` / `ProjectedCatalogOption` / `ProjectedCatalogDimension` wire shape for `GET /v1/catalogs`. No tags, no policy field — the deferred `CatalogPolicy` never crosses the Apache boundary.
