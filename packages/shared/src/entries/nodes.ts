/**
 * `@nodaro/shared/nodes` — Per-node-type rules: producer types, use-case node types, handle aliases, render nodes, JSON kinds, preview/render-final, settings inputs, node presets, collections.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/shared`.
 */
export { NODE_RUN_ROUTES, NODE_TYPES_WITHOUT_RUN_ROUTE, nodeRunRoute } from "../node-run-routes.js"
export { NODE_MAPPABLE_FIELDS, SUNO_FIELD_HANDLE_FIELDS, fieldKeyFromHandle } from "../node-mappable-fields.js"
export {
  SETTINGS_INPUT_HANDLE,
  SETTINGS_SOURCE_FIELDS,
  SETTINGS_INPUT_CONSUMERS,
  isSettingsSourceType,
  settingsInputAccepts,
  settingsInputFields,
  settingsSourceForField,
  settingsSourceForType,
  isSettingsHintEdge,
  isSettingsHintSource,
  SETTINGS_HINT_SOURCES,
  SETTINGS_SOURCE_TYPES,
  connectedSettingsSources,
  settingsProviderModels,
  snapToModelDuration,
  applySettingsInput,
  resolveWiredSettings,
  withWiredSettings,
  type SettingsInputProblem,
  type WiredSetting,
  type SettingsSourceType,
  type SettingsFieldSourceType,
  type SettingsHintSourceType,
  type SettingsField,
} from "../settings-input.js"
export {
  readScriptSettings,
  SCRIPT_SCENE_COUNT_RANGE,
  SCRIPT_SCENE_COUNT_DEFAULT,
  SCRIPT_TARGET_DURATION_RANGE,
  SCRIPT_TARGET_DURATION_DEFAULT,
  SCRIPT_TONE_MAX_LENGTH,
  SCRIPT_STYLE_GUIDE_MAX_LENGTH,
  type ScriptSettings,
} from "../script-settings.js"
export {
  RENDER_NODE_TYPES,
  RENDER_NODE_TYPE_IDS,
  OWNER_ONLY_LISTING_RENDER_TYPES,
  renderNodeOf,
  isRenderNodeType,
  rendersLatestBatch,
  rendersTranscriptJson,
  RENDER_JSON_HANDLE,
  renderTranscriptOutputOf,
  isRenderDataHandle,
  renderSavedJsonOutputs,
  type RenderTranscriptOutput,
  type RenderSavedJsonOutput,
  type RenderNodeDescriptor,
  type RenderClockSource,
  type RenderJsonKind,
} from "../render-nodes.js"
export {
  declaredJsonOutput,
  declaredJsonOutputRows,
  jsonOutputKind,
  jsonInputKind,
  jsonKindMismatch,
  jsonKindMismatchMessage,
  type JsonKind,
  type JsonKindMismatch,
  type JsonOutputDeclaration,
} from "../json-kinds.js"
export {
  PREVIEW_RENDER_NODE_TYPES,
  REVIEW_HOLDING_USE_CASE_TYPES,
  isPreviewHoldingType,
  PREVIEW_REVIEW_REQUIRED,
  PREVIEW_RENDER_NESTED,
  PREVIEW_REVIEW_REQUIRED_REVIEW_ON,
  PREVIEW_REVIEW_REQUIRED_MIXED,
  PREVIEW_RENDER_NESTED_REVIEW_ON,
  PREVIEW_RENDER_NESTED_MIXED,
  isPreviewRefusalCode,
  RUN_OVERRIDE_CLEARED_FIELDS,
  SAVED_RENDER_STAMPS,
  NO_SAVED_RENDER_STAMPS,
  rendersAsPreview,
  previewStops,
  previewGatedNodeIds,
  holdsPreviewRender,
  withRunOverrides,
  RUN_ONLY_NODE_FIELDS,
  type PreviewGateNode,
  type PreviewGateEdge,
  type PreviewGateRun,
  type PreviewStops,
  type SavedRenderQualityStamp,
  type SavedRenderStampReader,
} from "../preview-gate.js"
export { USE_CASE_NODE_TYPES, isUseCaseNodeType, type UseCaseNodeType } from "../use-case-types.js"
export {
  CONTINUATION_NOT_FOUND,
  CONTINUATION_WORKFLOW_MISMATCH,
  CONTINUATION_VERSION_MISMATCH,
  CONTINUATION_NOT_COMPLETED,
  CONTINUATION_SUBSET_REQUIRED,
  CONTINUATION_NOT_FAILED,
  CONTINUATION_SUPERSEDED,
  CONTINUATION_PREVIEW_PENDING,
  CONTINUATION_SETTLING,
  RENDER_FINAL_ALREADY_RENDERED,
  RENDER_FINAL_ALREADY_RENDERED_MESSAGE,
  USE_CASE_NOTHING_KEPT,
  USE_CASE_NOTHING_KEPT_MESSAGE,
  RUN_CONTINUATION_CODES,
  type RunContinuationCode,
} from "../run-continuation.js"
export {
  RENDER_FINAL_NODE_NOT_FOUND,
  RENDER_FINAL_NOT_A_RENDER,
  RENDER_FINAL_CODES,
  type RenderFinalCode,
} from "../render-final.js"
export {
  COLLECTION_NAME_MAX,
  COLLECTION_DESCRIPTION_MAX,
  COLLECTION_RECORD_TITLE_MAX,
  COLLECTION_RECORD_TEXT_MAX,
  COLLECTION_RECORD_URL_MAX,
  COLLECTION_RECORD_MEDIA_MAX,
  COLLECTION_RECORD_FIELDS_MAX,
  COLLECTION_RECORD_FIELDS_BYTES_MAX,
  COLLECTION_DEDUPE_KEY_MAX,
  COLLECTION_EVICT_MAX_PER_WRITE,
  COLLECTION_IDEMPOTENCY_KEY_MAX,
  COLLECTIONS_PAGE_MAX,
  COLLECTIONS_PAGE_DEFAULT,
  COLLECTION_HEADLINE_MAX,
  COLLECTION_MEDIA_TYPES,
  COLLECTION_TIER_CAPS,
  COLLECTION_DIGEST_SEPARATOR,
  COLLECTION_READ_WINDOW_HOURS_MAX,
  COLLECTION_READ_LIMIT_MAX,
  collectionReadSince,
  collectionCapsForTier,
  clampChars,
  fitCollectionField,
  normalizeDedupeKey,
  isCollectionUrl,
  isCollectionMedia,
  normalizeCollectionMedia,
  normalizeCollectionFields,
  collectionRecordHeadline,
  collectionRecordsDigest,
  ingestRecordFromJson,
  type CollectionMediaType,
  type CollectionMedia,
  type CollectionCaps,
  type CollectionLimits,
  type Collection,
  type CollectionRecordSource,
  type CollectionFieldValue,
  type CollectionRecord,
  type ListCollectionsResult,
  type CreateCollectionInput,
  type UpdateCollectionInput,
  type ListCollectionRecordsParams,
  type ListCollectionRecordsResult,
  type AddCollectionRecordInput,
  type CollectionWriteOutcome,
  type AddCollectionRecordResult,
  type CollectionExportFormat,
  type CollectionDigestFormat,
  type CollectionReadWindowUnit,
  type CollectionReadOrder,
  COLLECTION_USAGES,
  type CollectionUsage,
  type SetCollectionRecordUsedInput,
  COLLECTION_RECORD_STATUSES,
  type CollectionRecordStatus,
  COLLECTION_BULK_MAX,
  COLLECTION_BULK_ACTIONS,
  COLLECTION_RECORDS_OFFSET_MAX,
  type CollectionBulkAction,
  type BulkCollectionRecordsInput,
  type BulkCollectionRecordsResult,
  type IngestedRecord,
} from "../collections.js"
export * from "../node-pass-through.js"
export {
  transcribeWordTimestampsRefusal,
  findWordlessTranscriptFeeds,
} from "../transcribe-preflight.js"
export type { PreflightGraphNode, PreflightGraphEdge, WordlessTranscriptFeed } from "../transcribe-preflight.js"
export {
  VIDEO_PRODUCER_TYPES,
  AUDIO_PRODUCER_TYPES,
  DYNAMIC_PRODUCER_TYPES,
  IMAGE_PRODUCER_TYPES,
  FAN_OUT_EACH_TYPES,
  FAN_OUT_EACH_HANDLES,
  FAN_OUT_ALL_OR_NOTHING_TYPES,
  OWN_LIST_NODE_TYPES,
  ownsItsList,
  defaultEdgeOutputMode,
  listResultsServeHandle,
  FAN_IN_TARGETS,
  isFanInNodeType,
  isFanInEdge,
} from "../producer-types.js"
export * from "../fan-out-meta.js"
export { loneMediaUrlKind, isLoneMediaLinkSource } from "../lone-media-url.js"
export type { LoneMediaUrlKind } from "../lone-media-url.js"
export {
  MODEL_PARAM_NODE_TYPES,
  SOURCE_IMAGE_NODE_TYPES,
  AUTO_ASPECT_AT_RUN_NODE_TYPES,
  PHOTO_AUTO_ASPECT_NODE_TYPES,
  nodeAspectRatio,
  normalizeNodeModelParams,
  describeNodeAdjustments,
} from "../normalize-node-params.js"
export type { NodeParamAdjustment, NormalizedNodes } from "../normalize-node-params.js"
export { extractPresetData, PRESET_EXCLUDED_KEYS, PRESET_APPLY_CLEAR_KEYS, PRESET_LEVER_GROUPS, presetApplyClearKeys, presetLeverClearKeys, presetDataMatches } from "../node-preset-extract.js"
export { PROMPT_PREFIX_KEY, PROMPT_SUFFIX_KEY, readPromptAffixes } from "../prompt-affixes.js"
export type { PromptAffixFields, PromptAffixes } from "../prompt-affixes.js"
export type { ExportedPreset, NodePresetExport } from "../node-preset-export.js"
export {
  NODE_PRESET_EXPORT_KIND,
  buildNodePresetExport,
  parseNodePresetExport,
} from "../node-preset-export.js"
// A render's saved output (one reader for both engines) and its result stamps.
export * from "../render-output.js"
// Legacy handle ids → the canonical id every reader rewires them to (editor load, MCP writes, Copilot).
export * from "../handle-aliases.js"
// Site Capture node: what its image and json pips hand on, read by both engines.
export {
  SITE_CAPTURE_NODE_TYPE,
  SITE_CAPTURE_STILLS,
  siteCaptureMaxStills,
  siteCapturePageUrl,
  siteCaptureStills,
  siteCaptureStillUrls,
  siteCaptureNodeOutputs,
  type SiteCaptureStill,
} from "../site-capture-node.js"
