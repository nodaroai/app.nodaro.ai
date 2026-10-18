/**
 * `@nodaro/sdk/characters` — the `characters` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { CharactersResource } from "../resources/characters.js"

export type {
  Character,
  CharacterDetail,
  GetCharacterOptions,
  CharacterUsage,
  ReferencePhoto,
  ReferencePhotoKind,
  UpsertCharacterInput,
  UpsertCharacterResult,
  ListCharactersParams,
  ListCharactersResult,
  DuplicateCharacterInput,
  GenerateCharacterInput,
  GenerateCharacterResult,
  GenerateAssetInput,
  GenerateMotionInput,
  ApprovePortraitResult,
  RecaptionResult,
  CharacterTrainingState,
  CharacterTrainingStatus,
  TrainCharacterInput,
  TrainCharacterResult,
  TrainCharacterRefusalCode,
  CharacterAspectRatio,
  EntityStyle,
} from "../resources/characters.js"

export {
  CHARACTER_ASPECT_OPTIONS,
  CHARACTER_ASPECT_DEFAULTS,
  buildPersonSeedPrompt,
  buildPersonHints,
  PEOPLE,
  PERSON_DIMENSION_ORDER,
  PERSON_DIMENSION_LABELS,
  type PersonValue,
  CHARACTER_STYLES,
} from "../resources/characters.js"
