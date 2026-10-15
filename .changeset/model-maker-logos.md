---
"@nodaro/sdk": minor
"@nodaro/shared": minor
"@nodaro/cli": minor
---

Every model in the catalog names the company that made it, and can carry that company's mark. `client.models.list()` (`GET /v1/models`) adds two optional fields to each `ModelSummary`, both absent on an older server: `maker` — `{ id, name }` (new exported type `ModelMaker`), the company behind the model, with a stable id per company (`"google"`, `"black-forest-labs"`) an app can key its own assets on — and `logoUrl`, the maker's official mark (an SVG) on the instance's own media CDN, or `null` when the instance publishes none. Nothing has to change to keep working. To show the marks, read `maker` and `logoUrl`, use the address as given (it carries the file's version, so a replaced mark arrives under a new address), and draw a fallback such as the maker's name or initial when either is missing or `null`, or the maker id is one you do not know. A `logoUrl` is listed only once its file is in the instance's storage, never before it is uploaded. `@nodaro/shared`: `ModelCatalogEntry` gains a required `maker`, with the `MODEL_MAKERS` registry, `ModelMakerId`, `ModelMaker`, `isModelMakerId` and `modelMakerOf` (undefined for an entry whose maker is not in the registry; code that builds its own catalog entries must add a `maker`). `nodaro models list` shows a maker column, and `--json` carries both fields.
