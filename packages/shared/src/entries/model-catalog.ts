/**
 * `@nodaro/shared/model-catalog` — The model catalog (capability sheets + pricing rows) and the lookups derived from it.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/shared`.
 */
export * from "../seedance-draft.js"
export { isFlux2Model, FLUX2_RES_MP } from "../flux2-pricing.js"
export {
  GPT_IMAGE_2_6_DEFAULT_QUALITY,
  GPT_IMAGE_2_6_DEFAULT_RESOLUTION,
  GPT_IMAGE_2_6_DEFAULT_SVG_LEVEL,
  GPT_IMAGE_2_6_GIF_BANDS,
  GPT_IMAGE_2_6_GIF_DEFAULT_FRAMES,
  GPT_IMAGE_2_6_MAX_INPUT_IMAGES,
  GPT_IMAGE_2_6_METERED_QUALITY,
  GPT_IMAGE_2_6_QUALITIES,
  GPT_IMAGE_2_6_RESOLUTIONS,
  GPT_IMAGE_2_6_SVG_LEVELS,
  GPT_IMAGE_2_6_TIERED_I2I,
  GPT_IMAGE_2_6_TIERED_T2I,
  gptImage26EstimatedImages,
  gptImage26GifBand,
  gptImage26PricedFormat,
  imageFormatLeversOf,
  gptImage26SentImages,
  isGptImage26AutoRun,
  isGptImage26I2i,
  isGptImage26Tiered,
} from "../gpt-image-2-6.js"
export type { GptImage26GifBand, GptImage26PricedFormat, GptImage26SvgLevel, ImageFormatLevers } from "../gpt-image-2-6.js"
export {
  MINIMAX_H3_IMAGE_DEFAULT_RESOLUTION,
  MINIMAX_H3_IMAGE_I2I,
  MINIMAX_H3_IMAGE_MAX_INPUT_IMAGES,
  MINIMAX_H3_IMAGE_RESOLUTIONS,
  MINIMAX_H3_IMAGE_T2I,
  isMinimaxH3Image,
  isMinimaxH3ImageI2i,
  minimaxH3ImageCreditId,
} from "../minimax-h3-image.js"
export type { MinimaxH3ImageModel, MinimaxH3ImageResolution } from "../minimax-h3-image.js"
export {
  SEEDREAM_5_5_DEFAULT_RESOLUTION,
  SEEDREAM_5_5_I2I,
  SEEDREAM_5_5_MAX_INPUT_IMAGES,
  SEEDREAM_5_5_MIN_PROMPT_CHARS,
  SEEDREAM_5_5_RESOLUTIONS,
  SEEDREAM_5_5_T2I,
  isSeedream55,
  isSeedream55I2i,
  seedream55Resolution,
} from "../seedream-5-5.js"
export type { Seedream55Model, Seedream55Resolution } from "../seedream-5-5.js"
// The models priced by the input images a run sends, and how a run's images are counted.
export {
  isPricedPerInputImage,
  isPricedPerInputImageEdit,
  pricedEstimatedImages,
  pricedSentImages,
} from "../input-image-pricing.js"
export type { Flux2Model } from "../flux2-pricing.js"
// Model catalog (single source of truth for MCP `list_models` and the
// frontend config-panel registries).
export {
  MODEL_CATALOG,
  MODEL_RECOMMENDATIONS,
  // The companies behind the models (`maker` on every entry but one offered
  // under the deployment's own label, `ownLabel`; the wire's `maker`).
  MODEL_MAKERS,
  isModelMakerId,
  modelMakerOf,
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
  backgroundOptionsByKind,
  outputFormatOptionsByKind,
  svgLevelOptionsByKind,
  IMAGE_OUTPUT_FORMAT_LABELS,
  IMAGE_SVG_LEVEL_LABELS,
  IMAGE_GIF_FRAME_SIZE,
  TRANSPARENT_OUTPUT_FORMATS,
  MASKLESS_OUTPUT_FORMATS,
  MODEL_INPUT_ADJUSTMENT_FIELDS,
  creditRangesAll,
  modelIdsByKindMode,
  buildModelMenu,
  normalizeModelInput,
  normalizeVideoRequestParams,
  fitAspectRatioToModel,
  defaultResolutionFor,
  nearestCatalogAspectRatio,
  autoAspectNeedsSourceImage,
  maskEditMatchesSource,
  sourceImageSizeNeeded,
  resolutionNearestSource,
  maskedEditResolution,
  isAutoAspectToken,
  resolutionsAtAspectRatio,
  resolutionAtAspectRatio,
} from "../model-catalog.js"
export type {
  NormalizedVideoRequest,
  ModelCatalogEntry,
  ModelCatalogEntryFields,
  ModelKind,
  ModelMaker,
  ModelMakerId,
  ModelMode,
  ModelRecommendation,
  ModelValidationIssue,
  PriceVariant,
  ValidationField,
  LabeledOption,
  ModelMenuOption,
  ModelInputAdjustment,
  ModelInputAdjustmentField,
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
  defaultImageModelForNode,
  imageModelDrawsRatio,
} from "../image-model-roles.js"
export type { ImageModelRole } from "../image-model-roles.js"
export type { SafetyRetryPolicy } from "../safety-retry-policy.js"
export { VIDEO_DURATION_AUTO, isAutoVideoDuration } from "../video-duration-auto.js"
