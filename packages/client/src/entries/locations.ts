/**
 * `@nodaro/sdk/locations` — the `locations` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { LocationsResource } from "../resources/locations.js"

export type {
  Location,
  LocationDetail,
  LocationReferencePhoto,
  LocationReferencePhotoKind,
  CreateLocationInput,
  UpdateLocationInput,
  UpdateLocationResult,
  ListLocationsParams,
  GenerateLocationInput,
  GenerateLocationResult,
  GenerateLocationAssetInput,
  GenerateSurroundContinuationInput,
  ApproveMainImageResult,
  RecaptionLocationResult,
  LocationAssetType,
  LocationAttachColumn,
  SurroundDirection,
} from "../resources/locations.js"

export {
  LOCATION_ASSET_TYPES,
  LOCATION_ATTACH_COLUMNS,
  SURROUND_DIRECTIONS,
} from "../resources/locations.js"

export type { GenerateLocationMotionInput } from "../resources/locations.js"
