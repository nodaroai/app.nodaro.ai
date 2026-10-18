/**
 * `@nodaro/sdk/picker-catalogs` — the `picker-catalogs` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { PickerCatalogsResource } from "../resources/picker-catalogs.js"

export type {
  PickerOption,
  PickerDimension,
  PickerCatalog,
  PickerCatalogSummary,
  PickerCatalogSection,
  GetPickerCatalogOptions,
} from "../resources/picker-catalogs.js"

export type { TextToPickerParams, TextToPickerResult } from "../resources/picker-catalogs.js"
