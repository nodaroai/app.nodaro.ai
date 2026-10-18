/**
 * `@nodaro/sdk/creatures` — the `creatures` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { CreaturesResource } from "../resources/creatures.js"

export type {
  Creature,
  CreatureDetail,
  CreatureReferencePhoto,
  CreatureReferencePhotoKind,
  CreateCreatureInput,
  UpdateCreatureInput,
  UpdateCreatureResult,
  UpsertCreatureInput,
  UpsertCreatureResult,
  ListCreaturesParams,
  GenerateCreatureInput,
  GenerateCreatureResult,
  GenerateCreatureAssetInput,
  GenerateCreatureAssetResult,
  GenerateCreatureMotionInput,
  GenerateCreatureMotionResult,
  ApproveCreatureMainImageResult,
  RecaptionCreatureResult,
  CreatureAssetType,
  CreatureAttachColumn,
  CreatureAspectRatio,
} from "../resources/creatures.js"

export {
  CREATURE_ASSET_TYPES,
  CREATURE_ATTACH_COLUMNS,
  CREATURE_ASPECT_OPTIONS,
  CREATURE_ASPECT_DEFAULTS,
} from "../resources/creatures.js"

export type { CreatureVoice } from "../resources/creatures.js"
