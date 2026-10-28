/**
 * `@nodaro/shared/entities` — Characters, locations and objects: mention slugs, aspect defaults, entity fields and assets, references, reference sheets and boards.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/shared`.
 */
export { FEATURED_ENTITIES, getFeaturedEntities } from "../featured-entities.js"
export type { FeaturedEntity } from "../featured-entities.js"
export { KEEPER_CATALOG_CATEGORY_MAX, KEEPER_CATALOG_SORT_MAX } from "../keepers-limits.js"
export {
  IMAGE_REF_TYPES,
  PASSTHROUGH_TYPES,
  collectAncestorRefs,
} from "../ancestor-refs.js"
export {
  expandExtraRefsToConnectedReferences,
} from "../extra-refs.js"
export type {
  ExtraRefInput,
  ExtraRefCharacterContext,
} from "../extra-refs.js"
export {
  SURROUND_DIRECTIONS,
  DEFAULT_CARRIED_FRACTION,
  TILT_CARRIED_FRACTION,
  isTiltDirection,
  defaultCarriedFraction,
  type SurroundDirection,
} from "../surround.js"
export {
  OBJECT_ASPECT_OPTIONS,
  OBJECT_ASPECT_DEFAULTS,
  isObjectAspectRatio,
  resolveObjectAspectRatio,
  type ObjectAspectRatio,
  type ObjectAssetTypeForAspect,
  type ResolveObjectAspectOptions,
} from "../object-aspect-defaults.js"
export {
  characterMentionSlug,
  parseCharacterMentionToken,
  findCharacterMentionTokens,
} from "../character-mention-slug.js"
export type { CharacterMentionTokenInfo } from "../character-mention-slug.js"
export {
  CHARACTER_VARIANT_ASSET_BUCKETS,
  characterVariantAssetArrays,
  characterSheetRefItems,
  characterBoardItems,
  characterMentionableAssetArrays,
  CHARACTER_PICKER_DISPLAY_ORDER,
  characterBucketDisplayRank,
  sortCharacterEntriesForDisplay,
} from "../character-variant-assets.js"
export type {
  CharacterVariantAssetBucket,
  CharacterVariantAssetItem,
} from "../character-variant-assets.js"
export {
  LOCATION_USAGE_MODES,
  DEFAULT_LOCATION_USAGE_MODE,
  isLocationUsageMode,
  locationMentionSlug,
  locationUsageModeLabel,
  parseLocationMentionToken,
  findLocationMentionTokens,
} from "../location-mention-slug.js"
export type {
  LocationUsageMode,
  LocationMentionTokenInfo,
} from "../location-mention-slug.js"
export {
  imageMentionSlug,
  parseImageMentionToken,
  findImageMentionTokens,
  knownImageSlugsFromRefs,
  imageMentionSlugForRef,
} from "../image-mention-slug.js"
export type { ImageMentionTokenInfo } from "../image-mention-slug.js"
// Wired-creature / wired-object mentions — the SAME 2-or-3-segment grammar as
// the named-image mention (both are views of `mention-token-grammar.ts`), with
// their own ref gate. The grammar core itself stays internal to the package: it
// has no standalone consumer, and a third public `@slug:N` surface would invite
// call sites that bypass a kind's gate.
export {
  entityMentionSlug,
  parseEntityMentionToken,
  findEntityMentionTokens,
  knownEntitySlugsFromRefs,
  entityMentionSlugForRef,
} from "../entity-mention-slug.js"
export type { EntityMentionTokenInfo } from "../entity-mention-slug.js"
export {
  toConnectedReference,
  toConnectedReferences,
} from "../to-connected-references.js"
export type { EntityReferenceInput } from "../to-connected-references.js"
export {
  USAGE_MODES,
  DEFAULT_USAGE_MODE,
  isUsageMode,
  usageModeDirective,
  usageModeLabel,
  usageModeIncludesName,
} from "../character-usage-mode.js"
export type { UsageMode } from "../character-usage-mode.js"
export {
  CHARACTER_ASPECT_OPTIONS,
  CHARACTER_ASPECT_DEFAULTS,
  isCharacterAspectRatio,
  resolveCharacterAspectRatio,
} from "../character-aspect-defaults.js"
export type {
  CharacterAspectRatio,
  CharacterAssetTypeForAspect,
  ResolveCharacterAspectOptions,
} from "../character-aspect-defaults.js"
export {
  ENTITY_ASPECT_DEFAULTS,
  resolveEntityAspect,
  aspectRatioToNumber,
} from "../entity-aspect-defaults.js"
export type { EntityStudioKind } from "../entity-aspect-defaults.js"
// --- Reference Sheet (catalog, types, planner) ---
export * from "../reference-sheet/index.js"
// --- Reference Board (templates + provider constant) ---
export * from "../reference-board-templates.js"
// --- Entity image-handle parity (entity `image` source handle → plain image) ---
export * from "../entity-image-handle.js"
// --- Type-aware reference-role registry (presets + default + phrase renderer) ---
export * from "../reference-roles.js"
export * from "../entity-asset-types.js"
export {
  ENTITY_DB_ID_FIELD,
  ENTITY_NAME_FIELD,
  ENTITY_TABLE,
  ENTITY_BUCKET_FIELDS,
  ENTITY_KIND_SCALAR_FIELDS,
  ENTITY_SCALAR_FIELDS,
  entityScalarFields,
  entityHydrationColumns,
} from "../entity-node-fields.js"
export { ENTITY_NODE_KINDS } from "../entity-node-fields.js"
export type { EntityNodeKind } from "../entity-node-fields.js"
