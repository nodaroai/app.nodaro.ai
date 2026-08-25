---
"@nodaro/shared": minor
"@nodaro/prompts": minor
---

Person-pack curation is now enforced in the app UI, not only in `/v1/catalogs`.

`@nodaro/prompts`: `getRegisteredPeople()` — read directly by the picker-ui person grids — becomes the composed funnel, folding the same `CatalogPack` registry `composePickerCatalogs` folds (deny/replace/extend on `catalogId:"person"`, in registration order). A deny/replace pack now hides base person entries in the picker grids, not just in the catalogs projection. A guard test pins the grid's person id-set equal to the composed catalog's forever.

`@nodaro/shared`: two generic, content-free registration slots that `@nodaro/prompts` populates at pack-registration time (shared never imports prompts):
- `setRegisteredPersonPackFields([...])` so `getParameterValue(data, "person")` resolves a pack dimension in the `{PersonLabel}` field-mapping fallback.
- `registerCatalogSidecars(catalog, sidecars)` / `resetCatalogSidecars()` so a pack's localized sidecars resolve through `resolveLabel`/`resolveDescription`/`entryMatchesQuery` in the app UI.

All three are inert on mainline (empty registries = byte-identical behavior). No deployment-specific content enters either package.
