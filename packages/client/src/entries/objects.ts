/**
 * `@nodaro/sdk/objects` — the `objects` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { ObjectsResource } from "../resources/objects.js"

export type {
  Object,
  ObjectDetail,
  ObjectReferencePhoto,
  ObjectReferencePhotoKind,
  ObjectCategory,
  CreateObjectInput,
  UpdateObjectInput,
  UpdateObjectResult,
  UpsertObjectInput,
  UpsertObjectResult,
  ListObjectsParams,
  GenerateObjectInput,
  GenerateObjectResult,
  GenerateObjectAssetInput,
  GenerateObjectAssetResult,
  GenerateObjectMotionInput,
  GenerateObjectMotionResult,
  ApproveObjectMainImageResult,
  RecaptionObjectResult,
  ObjectAssetType,
  ObjectAttachColumn,
  ObjectAspectRatio,
} from "../resources/objects.js"

export {
  OBJECT_ASSET_TYPES,
  OBJECT_ATTACH_COLUMNS,
  OBJECT_ASPECT_OPTIONS,
  OBJECT_ASPECT_DEFAULTS,
} from "../resources/objects.js"
