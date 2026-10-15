/**
 * `@nodaro/shared/credits` — Credit identifiers, estimators and the per-feature pricing shapes (what a user pays, never a rate).
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/shared`.
 */
export { usdToCredits, creditsToUsd, CREDIT_ROUNDING_RESOLUTION } from "../credit-conversion.js"
export {
  FILM_BASE_CREDITS,
  KEYFRAME_CREDITS_PER_SHOT,
  VIDEO_CRITIC_CREDITS_PER_SHOT,
  VIDEO_CLIP_CREDITS,
  DEFAULT_VIDEO_CLIP_COST,
  estimateFilmCredits,
} from "../film-pricing.js"
export type { VideoClipCost, FilmCreditEstimate } from "../film-pricing.js"
export {
  buildCreditModelIdentifier,
  resolveImageGenCreditIdentifier,
  resolveNormalizedImageGen,
  normalizedImageGenModelId,
  imageGenAutoAspectNeedsSourceImage,
  buildVideoCreditModelIdentifier,
  seedanceVideoEditCreditId,
  videoGenerationCreditId,
  pricedVideoSelection,
  buildMotionCreditModelIdentifier,
  speedRampCreditId,
  applyEdlCreditId,
  speakerViewCreditId,
  SPEAKER_VIEW_CREDIT_IDS,
  SPEAKER_VIEW_PRICE_TIERS,
  type SpeakerViewPriceTier,
  type SpeakerViewCreditId,
  sunoCreditType,
  SUNO_VERSION_CREDIT_KEYS,
  SUNO_VERSION_PRICED_OPERATIONS,
  SUNO_SELECT_OPERATIONS,
} from "../credit-identifiers.js"
export type { NormalizedImageGen, PricedVideoSelection } from "../credit-identifiers.js"
export * from "../credit-estimators/index.js"
export {
  resolveTopazUpscale,
  TOPAZ_UPSCALE_FACTORS,
  TOPAZ_DEFAULT_UPSCALE_FACTOR,
  type TopazUpscaleFactor,
  type TopazUpscaleAdjustment,
  type TopazUpscaleResolution,
} from "../topaz-upscale.js"
export { calculateMonetizationMarkup, calculateMonetizedCost } from "../monetization.js"
export {
  LIP_SYNC_DURATION_BUCKETS,
  LIP_SYNC_MAX_AUDIO_SECONDS,
  pickLipSyncBucket,
  getLipSyncMaxAudioSeconds,
  isPerSecondLipSyncProvider,
  buildLipSyncCreditId,
} from "../lip-sync-pricing.js"
export type { LipSyncDurationBucket } from "../lip-sync-pricing.js"
export {
  AI_AVATAR_MAX_DURATION_SEC,
  AI_AVATAR_MAX_AUDIO_SEC,
  AI_AVATAR_DURATION_BUCKETS,
  AI_AVATAR_RESERVE_IDS,
  aiAvatarReserveCreditId,
  resolveAiAvatarCreditId,
  estimateScriptDurationSec,
  pickAiAvatarBucket,
} from "../ai-avatar-pricing.js"
export type { AiAvatarEngine, AiAvatarResolution, AiAvatarDurationBucket } from "../ai-avatar-pricing.js"
export * from "../switchx-pricing.js"
export {
  CINEMATIC_MIN_DURATION_SEC,
  CINEMATIC_MAX_DURATION_SEC,
  CINEMATIC_DEFAULT_DURATION_SEC,
  CINEMATIC_DEFAULT_RESOLUTION,
  CINEMATIC_RESERVE_IDS,
  clampCinematicDuration,
  cinematicCreditId,
  resolveCinematicCreditId,
} from "../cinematic-avatar-pricing.js"
export type { CinematicResolution } from "../cinematic-avatar-pricing.js"
export {
  AvatarPayloadError,
  validateAiAvatarPayload,
  validateCinematicAvatarPayload,
  CINEMATIC_PROMPT_MAX,
  CINEMATIC_MAX_REFERENCE_VIDEOS,
  CINEMATIC_MAX_REFERENCE_IMAGES,
  CINEMATIC_MIN_LOOKS,
  CINEMATIC_MAX_LOOKS,
} from "../avatar-payload-validators.js"
export {
  resolveStoredTier,
  resolveEffectiveTier,
  isPaygRetentionActive,
  PAYG_RETENTION_DAYS,
} from "../effective-tier.js"
// --- Video-analysis pricing (duration buckets + structural credit formula) ---
// Also hosts video-audit's sibling pricing (VIDEO_AUDIT_BUCKET_CREDITS +
// buildVideoAuditCreditId / videoAuditCreditsForBucket / bucketSecondsFromAuditCreditId).
export * from "../video-analysis-pricing.js"
// --- Content Recipe / Content Ideas pricing (credit ids + the per-five-ideas rule) ---
export * from "../content-recipe-ideas.js"
