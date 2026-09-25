---
"@nodaro/shared": minor
"@nodaro/prompts": minor
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Picker options now come with their pictures. Every option that has a picture carries an absolute `imageUrl` in `GET /v1/picker-catalogs/:nodeType`, `GET /v1/catalogs` and the MCP `get_picker_catalog` tool: the photos of the Person, Styling, Held Prop, Material and Animal pickers and the art of the music and voice pickers, served by the installation itself on its public address, plus — on Nodaro Cloud only — a still of each look picker's rendered preview from the Nodaro CDN. An option without a picture has no `imageUrl`. Person and Styling also return `sections`: the topics their settings are grouped under, in order, each with its round picture. The directory (`GET /v1/picker-catalogs`) adds `imageCount` per picker.

- `@nodaro/shared`: `ProjectedCatalogOption.imageUrl`, `ProjectedCatalog.sections`, `ProjectedCatalogSection`.
- `@nodaro/prompts`: the picture maps move here (`CHARACTER_ART_FILES`, `SOUND_ART`, `SOUND_ART_FILES`, `LOOK_PREVIEW_SETS`) with their path helpers, `STYLING_DIMENSION_SECTIONS`, and an `images` option on `projectPickerCatalog`, `projectAllCatalogs` and `summarizePickerCatalogs` (`imageCount` on `PickerCatalogSummary`).
- `@nodaro/sdk`: `PickerOption.imageUrl`, `PickerCatalog.sections` (`PickerCatalogSection`), `PickerCatalogSummary.imageCount`; the same on the `catalogs` types. `client.catalogs.list()` now returns `CatalogsListResponse` — `{ curated, packs, version, data? }` — which is what the server has always sent: `data` is absent when the deployment registered no catalog packs.
- `@nodaro/cli`: `nodaro pickers list` shows how many options of each picker have a picture.
