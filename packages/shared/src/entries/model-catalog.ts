/**
 * `@nodaro/shared/model-catalog` — The model catalog (capability sheets + pricing rows) and the lookups derived from it.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/shared`.
 */
export * from "../seedance-draft.js"
export { isFlux2Model, FLUX2_RES_MP } from "../flux2-pricing.js"
export type { Flux2Model } from "../flux2-pricing.js"
// Model catalog (single source of truth for MCP `list_models` and the
// frontend config-panel registries).
export {
  MODEL_CATALOG,
  MODEL_RECOMMENDATIONS,
  SPEECH_UNIT_PRICE_NOTE,
  listModels,
  groupByFamily,
  groupByKindAndFamily,
  MODEL_KINDS,
  getModel,
  validateModelInput,
  // Frontend picker derivers
  getAspectRatioOptions,
  getResolutionOptions,
  getQualityOptions,
  getDurationsForModel,
  getCreditRange,
  hasFeature,
  modelsWithFeature,
  modelTakesSeed,
  durationsByMode,
  resolutionOptionsByKind,
  aspectRatioOptionsByKind,
  qualityOptionsByKind,
  creditRangesAll,
  modelIdsByKindMode,
  buildModelMenu,
  normalizeModelInput,
  normalizeVideoRequestParams,
  fitAspectRatioToModel,
  defaultResolutionFor,
  nearestCatalogAspectRatio,
  autoAspectNeedsSourceImage,
  isAutoAspectToken,
} from "../model-catalog.js"
export type {
  NormalizedVideoRequest,
  ModelCatalogEntry,
  ModelKind,
  ModelMode,
  ModelRecommendation,
  ModelValidationIssue,
  PriceVariant,
  ValidationField,
  LabeledOption,
  ModelMenuOption,
  ModelInputAdjustment,
  NormalizedModelInput,
  ModelInputContext,
  SourceImageSize,
  TtsCapabilities,
  TtsSettingLever,
} from "../model-catalog.js"
// Speech-model capability lookups (derive from `ModelCatalogEntry.tts` above).
export {
  TTS_PROVIDER_ALIASES,
  TTS_FALLBACK_PROVIDER,
  canonicalTtsProvider,
  getTtsCapabilities,
  ttsSupportsAudioTags,
  ttsSupportsSsmlBreaks,
  ttsSupportsStitching,
  ttsHasLever,
  ttsLanguageCodes,
  ttsSupportsTimestamps,
} from "../tts-capabilities.js"
// Per-model safety-filter retry/fallback policy (derives from
// `ModelCatalogEntry.safetyFilter` above).
export { safetyRetryPolicy } from "../safety-retry-policy.js"
export {
  IMAGE_MODEL_ROLE_DEFAULTS,
  IMAGE_MODEL_RATIO_FALLBACKS,
  defaultImageModel,
  imageModelDrawsRatio,
} from "../image-model-roles.js"
export type { ImageModelRole } from "../image-model-roles.js"
export type { SafetyRetryPolicy } from "../safety-retry-policy.js"
export { VIDEO_DURATION_AUTO, isAutoVideoDuration } from "../video-duration-auto.js"
