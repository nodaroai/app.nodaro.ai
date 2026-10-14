/**
 * `@nodaro/shared/apps` — Published apps and the public API surface: presentation utils, exposed fields, picker restrictions, components, community listings, templates, OAuth scopes, recast segment packs.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/shared`.
 */
export {
  INPUT_NODE_TYPES,
  getInputNodes,
  getOutputNodes,
  getOutputType,
  getNodeResult,
  getNodeLabel,
  getInputFieldSchema,
  INPUT_FIELD_EXTRA_KEYS,
  getInputFieldExtraKeys,
  mergeNodeInputOverrides,
  flattenItems,
  migrateToItems,
  validateNoNestedGroups,
  cleanOrphanedItems,
  getItemSortId,
  type OutputType,
  type InputFieldSchema,
} from "../presentation-utils.js"
export {
  LEGACY_EXPOSED_FIELD_KEYS,
  canonicalExposedFieldKey,
  canonicalizeOverrideKeys,
} from "../exposed-field-keys.js"
export { findRestrictedPickerValue, type PickerCardRestrictions } from "../picker-restrictions.js"
export {
  INPUT_FIELD_MAP,
  OUTPUT_FIELD_MAP,
  HANDLE_PORT_SEPARATOR,
  mergeExposedSettings,
  parseHandleId,
  applyHandleInputOverride,
  isHandleInputWired,
  type ComponentMetadata,
  type ComponentHandle,
  type ExposedSetting,
} from "../component-types.js"
export type {
  CommunityEntityType,
  CommunitySort,
  CommunityReportReason,
  CommunityCard,
  CommunityFullDetail,
  BrowseCommunityParams,
  BrowseCommunityResult,
  CloneListingResult,
  FavoriteListingResult,
  ReportListingResult,
  PublishListingParams,
  PublishListingResult,
  SharedListing,
} from "../community.js"
export { OAUTH_SCOPES, type OAuthScope } from "../oauth-scopes.js"
export { RECAST_SEGMENT_PACKS, type RecastSegmentPack } from "../recast-segment-packs.js"
// --- Marketplace template categories (the eight use cases) ---
export * from "../template-categories.js"
