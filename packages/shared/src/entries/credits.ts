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
  imageFormatInputOf,
  normalizedImageGenModelId,
  imageGenAutoAspectNeedsSourceImage,
  buildVideoCreditModelIdentifier,
  seedanceVideoEditCreditId,
  tailExtendCreditId,
  tailExtendResolution,
  seedanceExtendRateCreditId,
  seedanceExtendFullWindowCreditId,
  seedanceExtendSourceCreditId,
  pixverseExtendCreditId,
  pixverseExtendQuality,
  catalogExtendCreditId,
  catalogExtendResolution,
  grokExtendCreditId,
  grokExtendSeconds,
  grokExtendWiredSourceResolution,
  seedanceExtendCreditId,
  seedanceExtendResolution,
  videoGenerationCreditId,
  pricedVideoSelection,
  buildMotionCreditModelIdentifier,
  motionTransferResolution,
  type MotionTransferResolution,
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
export type { NormalizedImageGen, PricedVideoSelection, GrokExtendSourceResolution } from "../credit-identifiers.js"
export {
  SEEDANCE_EXTEND_SENT_PRICED_PROVIDER,
  SEEDANCE_EXTEND_SENT_PRICED_PROVIDERS,
  SEEDANCE_EXTEND_RATE_CREDIT_IDS_BY_PROVIDER,
  SEEDANCE_EXTEND_MIN_SOURCE_SEC,
  SEEDANCE_EXTEND_CONTEXT_MAX_SEC,
  SEEDANCE_EXTEND_RATE_SECONDS,
  SEEDANCE_EXTEND_RATE_CREDIT_IDS,
  isSeedanceExtendPricedBySecondsSent,
  isSeedanceExtendRateCreditId,
  seedanceExtendAddedSec,
  seedanceExtendRefusesSource,
  seedanceExtendSourceRefused,
  seedanceExtendSourceSec,
  seedanceExtendSentSec,
  seedanceExtendUnits,
  type SentPricedSeedanceExtendProvider,
} from "../seedance-extend-rate.js"
export {
  geminiOmniExtendQuoteCreditId,
  parseGeminiOmniExtendQuoteCreditId,
  type GeminiOmniExtendQuoteCreditIdParts,
} from "../gemini-omni-extend-quote.js"
export * from "../credit-estimators/index.js"
export {
  resolveTopazUpscale,
  TOPAZ_UPSCALE_FACTORS,
  TOPAZ_DEFAULT_UPSCALE_FACTOR,
  type TopazUpscaleFactor,
  type TopazUpscaleAdjustment,
  type TopazUpscaleResolution,
} from "../topaz-upscale.js"
export {
  NODARO_IMAGE_UPSCALE_MODEL_ID,
  NODARO_IMAGE_UPSCALE_FACTORS,
  NODARO_IMAGE_UPSCALE_DEFAULT_FACTOR,
  UPSCALE_FACTORS,
  resolveNodaroImageUpscaleFactor,
  resolveUpscaleFactor,
  snappedUpscaleFactor,
  upscaleFactorsFor,
  type NodaroImageUpscaleFactor,
  type UpscaleFactor,
} from "../upscale-factors.js"
export { calculateMonetizationMarkup, calculateMonetizedCost } from "../monetization.js"
export {
  LIP_SYNC_DURATION_BUCKETS,
  LIP_SYNC_MAX_AUDIO_SECONDS,
  pickLipSyncBucket,
  getLipSyncMaxAudioSeconds,
  isPerSecondLipSyncProvider,
  LIP_SYNC_CHARGED_AT_RUN_COST,
  isLipSyncChargedAtRunCost,
  buildLipSyncCreditId,
  LIP_SYNC_AUDIO_RATES,
  OMNIHUMAN_2_0_PER_SECOND_CREDIT_ID,
  lipSyncAudioRateOf,
  lipSyncBilledSeconds,
  lipSyncHeldSeconds,
  lipSyncEstimateSeconds,
  lipSyncFifteenSecondCreditId,
  LIP_SYNC_UNMEASURED_ESTIMATE_SECONDS,
} from "../lip-sync-pricing.js"
export type { LipSyncDurationBucket, LipSyncAudioRate } from "../lip-sync-pricing.js"
export {
  MOTION_TRANSFER_MIN_SEC,
  MOTION_TRANSFER_IMAGE_ORIENTATION_MAX_SEC,
  MOTION_TRANSFER_MAX_SEC,
  MOTION_TRANSFER_SECOND_RATES,
  MOTION_TRANSFER_RATE_IDS,
  MOTION_TRANSFER_FLOOR_IDS,
  motionTransferOrientation,
  motionTransferMaxSec,
  motionTransferRateOf,
  motionTransferBilledSeconds,
  motionTransferPrice,
  motionTransferChargedPrice,
  motionTransferBaseCharge,
  checkMotionTransferLength,
  motionTransferEstimateSeconds,
  motionTransferEstimatePrice,
} from "../motion-transfer-pricing.js"
export type { MotionTransferSecondRate, MotionTransferPrice, MotionTransferLengthCheck } from "../motion-transfer-pricing.js"
export {
  CLIP_PRICED_V2V_PROVIDERS,
  HAPPYHORSE_EDIT_MIN_SEC,
  HAPPYHORSE_EDIT_MAX_SEC,
  WAN_VIDEOEDIT_MIN_SEC,
  WAN_VIDEOEDIT_MAX_SEC,
  WAN_VIDEOEDIT_FLOOR_CREDIT_ID,
  V2V_CLIP_RATES,
  V2V_CLIP_RATE_IDS,
  isClipPricedV2vProvider,
  v2vSeededRowCredits,
  videoToVideoClipMinSec,
  videoToVideoClipMaxSec,
  videoToVideoSentResolution,
  videoToVideoClipRateOf,
  videoToVideoBilledSeconds,
  checkVideoToVideoClipLength,
  videoToVideoClipPrice,
  wanVideoEditRateFromSeconds,
  videoToVideoEstimateSeconds,
  videoToVideoEstimatePrice,
} from "../video-to-video-pricing.js"
export type { ClipPricedV2vProvider, V2vClipRate, V2vClipLengthCheck, V2vClipPrice } from "../video-to-video-pricing.js"
export {
  AUDIO_ISOLATION_RATE_ID,
  AUDIO_ISOLATION_RATE_SECONDS,
  AUDIO_ISOLATION_MAX_SEC,
  AUDIO_ISOLATION_MAX_BYTES,
  AUDIO_ISOLATION_MAX_UNITS,
  audioIsolationUnits,
  audioIsolationTooLongMessage,
  checkAudioIsolationLength,
  audioIsolationEstimateUnits,
} from "../audio-isolation-pricing.js"
export type { AudioIsolationLengthCheck } from "../audio-isolation-pricing.js"
export {
  VOICE_CHANGER_RATE_ID,
  VOICE_CHANGER_RATE_SECONDS,
  VOICE_CHANGER_MAX_SEC,
  VOICE_CHANGER_MAX_UNITS,
  voiceChangerUnits,
  voiceChangerTooLongMessage,
  checkVoiceChangerLength,
  voiceChangerEstimateUnits,
} from "../voice-changer-pricing.js"
export type { VoiceChangerLengthCheck } from "../voice-changer-pricing.js"
export {
  SEEDANCE_LIP_SYNC_SECONDS,
  isSeedanceLipSyncProvider,
  seedanceLipSyncResolution,
  seedanceLipSyncCreditId,
  MINIMAX_H3_LIP_SYNC_CREDIT_ID,
  referenceAudioLipSyncCreditId,
} from "../seedance-lip-sync.js"
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
export {
  drivingAudioOf,
  takesDrivingAudio,
  isDrivingAudioRun,
  drivingAudioMaxSec,
  drivingAudioCreditId,
  drivingAudioRun,
  drivingAudioQuoteId,
  drivingAudioTooLongMessage,
  drivingAudioMinSec,
  DRIVING_AUDIO_SEND_MARGIN_SEC,
} from "../driving-audio.js"
export type { DrivingAudioRun, DrivingAudioRefusalCode } from "../driving-audio.js"
