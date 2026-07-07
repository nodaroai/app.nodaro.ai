import { supabase } from "../../lib/supabase.js"
import { hasCredits } from "../../lib/config.js"
import { getAppSettings } from "../../lib/app-settings.js"
import { FREE_TIER_RESTRICTIONS, TIER_STORAGE_LIMITS } from "./stripe-config.js"
import { buildCreditModelIdentifier, buildVideoCreditModelIdentifier, buildMotionCreditModelIdentifier, buildLlmCreditIdentifier, flux2BaseCredits, FLUX2_RES_MP, type Flux2Model, AI_AVATAR_DURATION_BUCKETS, AI_AVATAR_RATE_USD_PER_SEC, aiAvatarHoldCredits, resolveAiAvatarCreditId, type AiAvatarEngine, type AiAvatarResolution, CINEMATIC_RATE_USD_PER_SEC, CINEMATIC_MIN_DURATION_SEC, CINEMATIC_MAX_DURATION_SEC, cinematicCreditId, cinematicHoldCredits, resolveCinematicCreditId, type CinematicResolution, resolveSwitchXCreditId, VIDEO_ANALYSIS_DURATION_BUCKETS, VIDEO_ANALYSIS_MAX_DURATION_SEC, videoAnalysisBucketCredits, buildVideoAnalysisCreditId } from "@nodaro/shared"

// ── Flux 2 per-MP×ref static costs (generated from flux2BaseCredits formula) ──
// Identifier format: `<model>:<mp>MP:<n>ref` (e.g. `flux-2-max:2MP:1ref`)
// These are 0%-base credits (markup is applied once at lookup via getAppSettings).
const FLUX2_STATIC: Record<string, number> = {}
for (const m of ["flux-2-klein", "flux-2-pro", "flux-2-max"] as Flux2Model[]) {
  for (const mp of FLUX2_RES_MP) {
    for (let r = 0; r <= 8; r++) {
      FLUX2_STATIC[`${m}:${mp}MP:${r}ref`] = flux2BaseCredits(m, Number(mp), r)
    }
  }
}

// ── AI Avatar (HeyGen) duration-bucketed reserve holds ──
// 60 ids: 2 engines × 3 resolutions × 10 buckets (5/10/15/30/60/120/240/360/600/900s).
// The stored value is the at-cost 0%-base credit amount — NO *1.5 safety factor
// getModelCreditCostFromDB applies the admin markup (configurable) to this stored value
// at RESERVE time, and the reserve buckets UP (true clip ≤ bucket ceiling), so
// reserved ≥ metered-actual already (they're EQUAL at the bucket ceiling, where
// both derive from the same base). The old *1.5 double-buffered
// on top of the runtime markup — the user-reported over-reservation. The actual
// charge is recomputed at job completion by commitJobCredits/computeActualCredits
// from the provider's real USD cost; commit_credits refunds any surplus.
// A missing id causes a hard 503 `price_not_configured` at runtime.
const AI_AVATAR_STATIC: Record<string, number> = {}
for (const engine of Object.keys(AI_AVATAR_RATE_USD_PER_SEC) as AiAvatarEngine[]) {
  for (const resolution of Object.keys(AI_AVATAR_RATE_USD_PER_SEC[engine]) as AiAvatarResolution[]) {
    for (const bucketSec of AI_AVATAR_DURATION_BUCKETS) {
      const id = `heygen-${engine}:${resolution}:${bucketSec}s`
      AI_AVATAR_STATIC[id] = aiAvatarHoldCredits(engine, resolution, bucketSec)
    }
  }
}

// ── Cinematic Avatar (HeyGen `type:"cinematic_avatar"`) exact-duration holds ──
// 24 ids: 2 resolutions × 12 durations (4..15s). Duration is a USER PARAMETER
// (known at submit), so the reserve id encodes the EXACT requested duration —
// no bucketing. The stored value is the at-cost 0%-base credit amount. NO *1.5
// the admin markup is applied to this stored value at RESERVE time, so the
// reserved tier equals the metered actual (same exact duration, same base).
// A missing id causes a hard 503 `price_not_configured` at runtime.
const CINEMATIC_STATIC: Record<string, number> = {}
for (const resolution of Object.keys(CINEMATIC_RATE_USD_PER_SEC) as CinematicResolution[]) {
  for (let d = CINEMATIC_MIN_DURATION_SEC; d <= CINEMATIC_MAX_DURATION_SEC; d++) {
    CINEMATIC_STATIC[cinematicCreditId(resolution, d)] = cinematicHoldCredits(resolution, d)
  }
}

// ── Video Analysis (Gemini vision) duration-bucketed reserve holds ──
// Values are DERIVED from the structural formula `videoAnalysisBucketCredits`
// (packages/shared/src/video-analysis-pricing.ts) — never hand-written —
// mirroring the FLUX2/AI_AVATAR/CINEMATIC spreads above.
// Per model: a bare id `video-analysis:<model>` (= the 600s unknown-duration
// ceiling) + one composite per bucket `video-analysis:<model>:<bucket>s`.
// The two models mirror the catalog's video-analysis entries (model-catalog.ts)
// and the model_pricing rows (migrations 247+248) — extend all of them together
// if a third video+audio model ships.
//
// [econ-intel comment removed]
// throughput constants with a safety margin over measured values:
//   gemini-3-flash → bare 3 · 60s 1 · 180s 1 · 360s 2 · 600s 3
//   gemini-3.1-pro → bare 11 · 60s 2 · 180s 3 · 360s 7 · 600s 11
// The pricing test pins these worked examples; if a rate or constant shifts
// them, ship a convergence migration (mirror 248) in the same PR.
const VIDEO_ANALYSIS_STATIC: Record<string, number> = {}
for (const model of ["gemini-3-flash", "gemini-3.1-pro"]) {
  // Bare per-model id (`video-analysis:<model>`) = the unknown-duration ceiling
  // (600s). buildVideoAnalysisCreditId NEVER produces this id — it always appends
  // a `:<bucket>s` suffix; the bare id exists in STATIC only because MODEL_CATALOG
  // lists `video-analysis:<model>` as each model's base pricing row.
  VIDEO_ANALYSIS_STATIC[`video-analysis:${model}`] = videoAnalysisBucketCredits(
    model,
    VIDEO_ANALYSIS_MAX_DURATION_SEC,
  )
  for (const bucketSec of VIDEO_ANALYSIS_DURATION_BUCKETS) {
    VIDEO_ANALYSIS_STATIC[`video-analysis:${model}:${bucketSec}s`] =
      videoAnalysisBucketCredits(model, bucketSec)
  }
}

// ============================================================
// Types
// ============================================================

export interface CreditCheckResult {
  allowed: boolean
  error?: string
  balance?: number
  required?: number
  dailyLimit?: number
  dailySpent?: number
  subscriptionCredits?: number
  topupCredits?: number
  watermark?: boolean
  /** App credits allowance shortage (only set when app run is blocked for free users) */
  appCreditsAllowance?: number
}

export interface UserBalance {
  total: number
  subscription: number
  topup: number
  dailySpent: number
  dailyLimit: number | null
  monthlyAllocation: number
  tier: string
  features: Record<string, unknown>
  periodEnd: string | null
  /** Credits earned for app usage (free tier only — earned by running flows) */
  appCreditsAllowance: number
}

export interface ReserveResult {
  usageLogId: string
  creditsReserved: number
  watermark: boolean
}

export interface StorageLimitResult {
  allowed: boolean
  error?: string
  usedBytes: number
  limitBytes: number
}

/**
 * Pre-fetched profile shape for checkCreditsWithProfile.
 * Must include credit-related columns.
 */
export interface CreditProfile {
  tier?: string | null
  subscription_tier?: string | null
  subscription_credits?: number | null
  topup_credits?: number | null
  daily_spent_credits?: number | null
  last_daily_reset?: string | null
  app_credits_allowance?: number | null
}

/**
 * Pre-fetched profile shape for checkStorageLimitWithProfile.
 * Must include storage columns + tier for fallback.
 */
export interface StorageProfile {
  tier?: string | null
  storage_used_bytes?: number | null
  storage_limit_bytes?: number | null
}

// ============================================================
// Errors
// ============================================================

// See backend/CLAUDE.md "Hard-Fail Policy for Missing Prices" for the policy
// rationale. Translated to HTTP 503 `price_not_configured` by credit-guard-impl.
export class PriceNotConfiguredError extends Error {
  readonly modelIdentifier: string
  constructor(modelIdentifier: string) {
    super(`Pricing is not configured for "${modelIdentifier}".`)
    this.name = "PriceNotConfiguredError"
    this.modelIdentifier = modelIdentifier
  }
}

// ============================================================
// Fallback Static Credit Costs (used when model_pricing table doesn't exist)
// ============================================================

export const STATIC_CREDIT_COSTS: Record<string, number> = {
  // Credits = ceil(kieCredits / 4) at 0% markup.
  // Markup % is configurable in admin settings (app_settings.cost_markup_percent).
  // Base entries = default/cheapest setting. Composite entries = specific setting.
  //
  // ── Image Generation ──
  "nano-banana": 1,
  "nano-banana-2": 4,             // (1K default)
  "nano-banana-2:2K": 5,
  "nano-banana-2:4K": 5,
  "nano-banana-pro": 5,          // (1K/2K default)
  "nano-banana-pro:4K": 6,
  "flux": 2,                     // (1K default)
  "flux:2K": 2,
  "grok": 1,
  "gpt-image": 4,                // (medium default)
  "gpt-image:high": 6,
  "gpt-image-2": 1,              // (1K default; estimated, recalibrate from anomalies)
  "gpt-image-2:2K": 3,           // (estimated)
  "gpt-image-2:4K": 6,           // (estimated)
  "reference-sheet:assembly": 4, // Flat sheet-assembly fee; per-panel gen priced separately (bare provider key)
  "reference-sheet:assembly-motion": 6, // Flat FFmpeg-assembly fee for motion sheets; motion clips priced separately by the motion routes
  "imagen4": 2,
  "imagen4-fast": 1,
  "imagen4-ultra": 3,
  "qwen": 1,
  "seedream": 2,
  "seedream:high": 4,            // estimated (4K)
  "seedream-5-lite": 2,
  "seedream-5-lite:high": 5,     // estimated (4K)
  "flux-flex": 4,                // (1K default)
  "flux-flex:2K": 6,
  "z-image": 1,
  "flux-kontext": 2,
  "flux-kontext-max": 4,
  // ── Replicate "Open" (uncensored) — run direct via Replicate, not KIE ──
  // Base rows (representative default-resolution 0-ref) — for admin display and
  // single-node runs where no :MP:ref composite is available yet.
  // Per-MP×ref composites are spread below via FLUX2_STATIC.
  "flux-2-klein": 1,             // default 1MP 0ref — BFL Flux 2 9B Klein via Replicate
  "kontext-multi": 3,            // multi-image-kontext-pro via Replicate
  "flux-2-pro": 3,               // default 2MP 0ref — BFL Flux 2 Pro via Replicate, safety_tolerance=5
  "flux-2-max": 7,               // default 2MP 0ref — BFL Flux 2 Max via Replicate, safety_tolerance=5
  // Full per-MP×ref grid for Flux 2 family (108 entries, see flux2BaseCredits formula).
  // Identifier format: `<model>:<mp>MP:<n>ref` (mp ∈ {0.5,1,2,4}, n ∈ 0..8).
  ...FLUX2_STATIC,
  // AI Avatar (HeyGen) — 42 duration-bucketed reserve holds (2 engines × 3 resolutions × 7 buckets (30/60/120/240/360/600/900s)).
  // Format: `heygen-<engine>:<resolution>:<bucketSec>s`  e.g. `heygen-avatar-iv:720p:60s`.
  // Hold; actual charge metered at commit, surplus refunded.
  ...AI_AVATAR_STATIC,
  // Cinematic Avatar (HeyGen) — 24 exact-duration reserve holds (2 resolutions × 12 durations 4..15s).
  // Format: `cinematic-avatar:<resolution>:<durationSec>s`  e.g. `cinematic-avatar:720p:10s`.
  // Hold; actual charge metered at commit, surplus refunded.
  // Rate is an UNCONFIRMED estimate — confirm via a paid run per audit-credits ship-gate.
  ...CINEMATIC_STATIC,
  // ── Video Analysis (Gemini vision, duration-bucketed) — PROVISIONAL (Task 18a) ──
  // Node-type bare = estimate fallback ONLY (STATIC_CREDIT_COSTS[node.type] in
  // estimateWorkflowCredits; never reserved). Pinned to the cheapest model's
  // 10-min ceiling (gemini-3-flash @ 600s = 3). Per-model bares + 8 duration
  // composites are formula-derived above (VIDEO_ANALYSIS_STATIC); see that block
  // for the PROVISIONAL/Gate-0.5 (18b) reconciliation note.
  "video-analysis": videoAnalysisBucketCredits("gemini-3-flash", VIDEO_ANALYSIS_MAX_DURATION_SEC),
  ...VIDEO_ANALYSIS_STATIC,
  "flux-lora-character": 2,      // flux-dev-lora inference via Replicate. Internal-only id selected by payload-builder when a single trained @character is mentioned.
  "character-lora-training": 150, // Replicate ostris/flux-dev-lora-trainer (1000 steps, one-shot). Refunded by webhook on failure/cancel.
  // ── Image Editing ──
  "recraft-upscale": 1,
  "recraft-remove-bg": 1,
  "nano-banana-edit": 2,
  "topaz-image-upscale": 3,      // (2K default)
  "topaz-image-upscale:4K": 5,
  "topaz-image-upscale:8K": 10,
  "grok-upscale": 3,
  // ── Image-to-Image ──
  "flux-i2i": 4,                 // (1K default)
  "flux-i2i:2K": 6,
  "flux-pro-i2i": 2,             // (1K default)
  "flux-pro-i2i:2K": 2,
  "grok-i2i": 1,
  "gpt-image-i2i": 4,            // (medium default)
  "gpt-image-i2i:high": 6,
  "gpt-image-2-i2i": 1,          // (1K default; estimated)
  "gpt-image-2-i2i:2K": 3,       // (estimated)
  "gpt-image-2-i2i:4K": 6,       // (estimated)
  "ideogram-edit": 5,            // (BALANCED default)
  "ideogram-edit:TURBO": 3,
  "ideogram-edit:QUALITY": 6,
  "ideogram-remix": 5,           // (BALANCED default)
  "ideogram-remix:TURBO": 3,
  "ideogram-remix:QUALITY": 6,
  "ideogram-reframe": 2,         // (V3 Reframe BALANCED)
  "ideogram-reframe:TURBO": 1,
  "ideogram-reframe:QUALITY": 3,
  "ideogram-v3": 2,              // (BALANCED default)
  "ideogram-v3:TURBO": 1,
  "ideogram-v3:QUALITY": 3,
  "qwen-i2i": 1,
  "qwen-edit": 2,
  "seedream-edit": 2,
  "seedream-edit:high": 4,       // estimated (4K)
  "seedream-5-lite-i2i": 2,
  "seedream-5-lite-i2i:high": 5, // estimated (4K)
  // ── Video Generation (I2V / T2V) ──
  "minimax": 15,                 // (6s, 1080p)
  "veo3": 63,                    // (VEO 3.1 Quality)
  "veo3.1": 15,                  // (VEO 3.1 Fast @ 720p)
  "veo3.1:1080p": 17,            // (VEO 3.1 Fast @ 1080p)
  "veo3_lite": 8,               // (VEO 3.1 Lite @ 720p)
  "veo3_lite:1080p": 9,         // (VEO 3.1 Lite @ 1080p)
  // Direct-4K generation (base 1080p → chained get-4k-video). Base cost, NO markup
  // (admin panel applies markup). KIE: ceil(KIE_cr/4). docs.kie.ai VEO 3.1 4K.
  "veo3:4k": 93,                 // (VEO 3.1 Quality @ 4K)
  "veo3.1:4k": 45,               // (VEO 3.1 Fast @ 4K)
  "veo3_lite:4k": 38,           // (VEO 3.1 Lite @ 4K)
  "kling": 28,                   // (10s no-audio fallback)
  // Kling 2.6 duration-tiered pricing (5s/10s, audio doubles cost)
  "kling:5s": 14,                // (5s no audio)
  "kling:10s": 28,               // (10s no audio)
  "kling:5s:audio": 28,          // (5s with audio)
  "kling:10s:audio": 55,         // (10s with audio)
  "kling-turbo": 11,             // (5s fallback)
  // Kling Turbo duration-tiered pricing
  "kling-turbo:5s": 11,
  "kling-turbo:10s": 21,
  "kling-3.0": 50,               // (5s, audio, 1080P — 40 cr/sec) — fallback only
  // Kling 3.0 duration-tiered pricing (1080P, per-second: 27 no audio, 40 with audio)
  "kling-3.0:5s": 34,            // (1080P, no audio, 5s)
  "kling-3.0:10s": 68,           // (1080P, no audio, 10s)
  "kling-3.0:15s": 102,          // (1080P, no audio, 15s)
  "kling-3.0:5s:audio": 50,      // (1080P, audio, 5s)
  "kling-3.0:10s:audio": 100,    // (1080P, audio, 10s)
  "kling-3.0:15s:audio": 150,    // (1080P, audio, 15s)
  "grok-i2v": 5,                 // (6s fallback)
  // Grok I2V duration-tiered pricing (shared with grok T2V)
  "grok-i2v:6s": 5,
  "grok-i2v:10s": 8,
  "grok-i2v:15s": 10,
  // ── Grok Imagine Video 1.5 (KIE) — per-second billing, 480p/720p, image-to-video. ──
  // KIE 14.5 cr/s @480p, 25 cr/s @720p, +2 cr/image (always 1 image → +2 in every tier).
  // Nodaro = ceil(KIE_total / 4) — priced at cost, like Seedance-2. Base = 8s/480p.
  "grok-imagine-video-1.5": 30,
  // 480p (KIE 14.5 cr/s + 2)
  "grok-imagine-video-1.5:1s:480p": 5,
  "grok-imagine-video-1.5:2s:480p": 8,
  "grok-imagine-video-1.5:3s:480p": 12,
  "grok-imagine-video-1.5:4s:480p": 15,
  "grok-imagine-video-1.5:5s:480p": 19,
  "grok-imagine-video-1.5:6s:480p": 23,
  "grok-imagine-video-1.5:7s:480p": 26,
  "grok-imagine-video-1.5:8s:480p": 30,
  "grok-imagine-video-1.5:9s:480p": 34,
  "grok-imagine-video-1.5:10s:480p": 37,
  "grok-imagine-video-1.5:11s:480p": 41,
  "grok-imagine-video-1.5:12s:480p": 44,
  "grok-imagine-video-1.5:13s:480p": 48,
  "grok-imagine-video-1.5:14s:480p": 52,
  "grok-imagine-video-1.5:15s:480p": 55,
  // 720p (KIE 25 cr/s + 2)
  "grok-imagine-video-1.5:1s:720p": 7,
  "grok-imagine-video-1.5:2s:720p": 13,
  "grok-imagine-video-1.5:3s:720p": 20,
  "grok-imagine-video-1.5:4s:720p": 26,
  "grok-imagine-video-1.5:5s:720p": 32,
  "grok-imagine-video-1.5:6s:720p": 38,
  "grok-imagine-video-1.5:7s:720p": 45,
  "grok-imagine-video-1.5:8s:720p": 51,
  "grok-imagine-video-1.5:9s:720p": 57,
  "grok-imagine-video-1.5:10s:720p": 63,
  "grok-imagine-video-1.5:11s:720p": 70,
  "grok-imagine-video-1.5:12s:720p": 76,
  "grok-imagine-video-1.5:13s:720p": 82,
  "grok-imagine-video-1.5:14s:720p": 88,
  "grok-imagine-video-1.5:15s:720p": 95,
  "seedance": 7,                 // (8s default; actual 3.5 KIE/sec)
  // Seedance duration-tiered pricing (/sec)
  "seedance:4s": 4,
  "seedance:8s": 7,
  "seedance:12s": 15,            // (actual from audit)
  // ── Seedance 2.0 — per-second billing, resolution × video-ref dimensions ──
  // Base fallback (8s/480p/no-ref)
  "seedance-2": 38,
  // 480p no video ref (/s)
  "seedance-2:4s:480p": 19,
  "seedance-2:8s:480p": 38,
  "seedance-2:12s:480p": 57,
  "seedance-2:15s:480p": 72,
  // 480p with video ref (/s)
  "seedance-2:4s:480p-ref": 12,
  "seedance-2:8s:480p-ref": 23,
  "seedance-2:12s:480p-ref": 35,
  "seedance-2:15s:480p-ref": 44,
  // 720p no video ref (/s)
  "seedance-2:4s:720p": 41,
  "seedance-2:8s:720p": 82,
  "seedance-2:12s:720p": 123,
  "seedance-2:15s:720p": 154,
  // 720p with video ref (/s)
  "seedance-2:4s:720p-ref": 25,
  "seedance-2:8s:720p-ref": 50,
  "seedance-2:12s:720p-ref": 75,
  "seedance-2:15s:720p-ref": 94,
  // 1080p — authoritative KIE rate is /s (no video) / 62 (with video)
  // ~2.49× the 720p rate (the original 1.5× estimate under-billed ~40%; KIE pricing
  // page verified 2026-06-25).
  "seedance-2:4s:1080p": 102,
  "seedance-2:8s:1080p": 204,
  "seedance-2:12s:1080p": 306,
  "seedance-2:15s:1080p": 383,   // → ceil
  // 1080p with video ref (/s)
  "seedance-2:4s:1080p-ref": 62,
  "seedance-2:8s:1080p-ref": 124,
  "seedance-2:12s:1080p-ref": 186,
  "seedance-2:15s:1080p-ref": 233, // → ceil
  // 4K (/s no video / 128 with video) — full seedance-2 only.
  "seedance-2:4s:4k": 208,
  "seedance-2:8s:4k": 416,
  "seedance-2:12s:4k": 624,
  "seedance-2:15s:4k": 780,
  "seedance-2:4s:4k-ref": 128,
  "seedance-2:8s:4k-ref": 256,
  "seedance-2:12s:4k-ref": 384,
  "seedance-2:15s:4k-ref": 480,
  // ── Seedance 2.0 Fast — same matrix, lower rates ──
  "seedance-2-fast": 31,
  // 480p no video ref (/s)
  "seedance-2-fast:4s:480p": 16,
  "seedance-2-fast:8s:480p": 31,
  "seedance-2-fast:12s:480p": 47,
  "seedance-2-fast:15s:480p": 59,
  // 480p with video ref (/s)
  "seedance-2-fast:4s:480p-ref": 9,
  "seedance-2-fast:8s:480p-ref": 18,
  "seedance-2-fast:12s:480p-ref": 27,
  "seedance-2-fast:15s:480p-ref": 34,
  // 720p no video ref (/s)
  "seedance-2-fast:4s:720p": 33,
  "seedance-2-fast:8s:720p": 66,
  "seedance-2-fast:12s:720p": 99,
  "seedance-2-fast:15s:720p": 124,
  // 720p with video ref (/s)
  "seedance-2-fast:4s:720p-ref": 20,
  "seedance-2-fast:8s:720p-ref": 40,
  "seedance-2-fast:12s:720p-ref": 60,
  "seedance-2-fast:15s:720p-ref": 75,
  // NOTE: seedance-2-fast has NO 1080p tier — KIE sells it at 480p/720p only
  // (verified KIE pricing page 2026-06-25, 4 SKUs). The full seedance-2 has 1080p/4K.
  // ── Seedance 2.0 Mini — budget tier, 480p/720p only, per-second × video-ref ──
  // Base fallback (8s/480p/no-ref)
  "seedance-2-mini": 19,
  // 480p no video ref (/s)
  "seedance-2-mini:4s:480p": 10,
  "seedance-2-mini:8s:480p": 19,
  "seedance-2-mini:12s:480p": 29,
  "seedance-2-mini:15s:480p": 36,
  // 480p with video ref (/s)
  "seedance-2-mini:4s:480p-ref": 6,
  "seedance-2-mini:8s:480p-ref": 12,
  "seedance-2-mini:12s:480p-ref": 18,
  "seedance-2-mini:15s:480p-ref": 23,
  // 720p no video ref (/s)
  "seedance-2-mini:4s:720p": 21,
  "seedance-2-mini:8s:720p": 41,
  "seedance-2-mini:12s:720p": 62,
  "seedance-2-mini:15s:720p": 77,
  // 720p with video ref (/s)
  "seedance-2-mini:4s:720p-ref": 13,
  "seedance-2-mini:8s:720p-ref": 25,
  "seedance-2-mini:12s:720p-ref": 38,
  "seedance-2-mini:15s:720p-ref": 47,
  // ── Gemini Omni Video (KIE) —; Nodaro. Lowercase 4k. ──
  "gemini-omni-video": 23,         // base = 720p/1080p 4s
  "gemini-omni-video:4": 23,
  "gemini-omni-video:6": 30,
  "gemini-omni-video:8": 38,
  "gemini-omni-video:10": 45,
  "gemini-omni-video:4k:4": 53,
  "gemini-omni-video:4k:6": 60,
  "gemini-omni-video:4k:8": 68,
  "gemini-omni-video:4k:10": 75,
  "gemini-omni-video:vref": 60,    // (video-edit, flat)
  "gemini-omni-video:4k:vref": 90,// (video-edit 4K, flat)
  "wan-i2v": 18,                 // (5s 720p fallback)
  // Wan I2V duration-tiered pricing (720p default)
  "wan-i2v:5s": 18,
  "wan-i2v:10s": 35,
  "wan-i2v:15s": 53,
  "wan-turbo": 10,               // (5s, 480p I2V default)
  "hailuo-2.3-pro": 20,          // (10s fallback, actual from audit)
  // Hailuo 2.3 Pro duration-tiered pricing (768p default)
  "hailuo-2.3-pro:6s": 13,       // (estimated from audit)
  "hailuo-2.3-pro:10s": 20,      // (actual from audit)
  "hailuo-2.3": 8,              // (6s fallback)
  // Hailuo 2.3 duration-tiered pricing
  "hailuo-2.3:6s": 8,
  "hailuo-2.3:10s": 13,
  "hailuo-standard": 8,         // (6s fallback)
  // Hailuo Standard duration-tiered pricing
  "hailuo-standard:6s": 8,
  "hailuo-standard:10s": 13,
  "bytedance-lite": 6,            // (actual from audit)
  "bytedance-pro": 18,            // (actual from audit)
  "bytedance-pro-fast": 9,       // (actual from audit)
  "kling-master": 40,            // (5s fallback)
  // Kling Master duration-tiered pricing
  "kling-master:5s": 40,
  "kling-master:10s": 80,
  "kling-3-omni": 25,            // Replicate, est (5s 720p fallback)
  // Kling 3 Omni duration-tiered pricing (Replicate, estimated — actual cost tracked via predict_time)
  "kling-3-omni:5s": 25,         // est
  "kling-3-omni:10s": 50,        // est
  "kling-3-omni:15s": 75,        // est
  // ── Lightricks LTX 2.3 (Replicate) — official pricing from replicate.com/lightricks/ltx-2.3-{pro,fast} ──
  // Per-second of output video: Pro (1080p/2k/4k), Fast
  // Formula: per second × duration → cr/sec: Pro Fast
  // Pro: text/image/audio→video, 1080p/2k/4k, durations s. Base = 1080p:6s.
  "ltx-2.3-pro": 24,             // default = 1080p:6s
  "ltx-2.3-pro:1080p:6s": 24,    // → ceil = 30
  "ltx-2.3-pro:1080p:8s": 32,
  "ltx-2.3-pro:1080p:10s": 40,
  "ltx-2.3-pro:2k:6s": 48,
  "ltx-2.3-pro:2k:8s": 64,
  "ltx-2.3-pro:2k:10s": 80,
  "ltx-2.3-pro:4k:6s": 96,
  "ltx-2.3-pro:4k:8s": 128,
  "ltx-2.3-pro:4k:10s": 160,
  // Fast: text/image→video, 1080p/2k/4k, durations 6–20s (1080p only past 10s). Base = 1080p:6s.
  "ltx-2.3-fast": 18,            // default = 1080p:6s
  "ltx-2.3-fast:1080p:6s": 18,   // ceil = ceil(22.5)
  "ltx-2.3-fast:1080p:8s": 24,
  "ltx-2.3-fast:1080p:10s": 30,
  "ltx-2.3-fast:1080p:12s": 36,
  "ltx-2.3-fast:1080p:14s": 42,
  "ltx-2.3-fast:1080p:16s": 48,
  "ltx-2.3-fast:1080p:18s": 54,
  "ltx-2.3-fast:1080p:20s": 60,
  "ltx-2.3-fast:2k:6s": 36,      // ceil = 45
  "ltx-2.3-fast:2k:8s": 48,
  "ltx-2.3-fast:2k:10s": 60,
  "ltx-2.3-fast:4k:6s": 72,      // = 90
  "ltx-2.3-fast:4k:8s": 96,
  "ltx-2.3-fast:4k:10s": 120,
  // LTX extend + retake (Pro only, 1080p): per-second × duration at credit-guard time.
  // 5 cr/sec matches Pro:1080p rate (extend output is at the input's resolution; retake is locked 1080p).
  "ltx-2.3-pro-extend:per-second": 4,
  // ── Seedance 2 Extend — trim-stitch continuation of ANY video (rates =
  //    seedance-2 -ref matrix + 3cr ffmpeg stitch; spike findings 2026-06-11) ──
  "seedance-2-extend": 53,             // default 8s 720p
  "seedance-2-extend:4s:480p": 15,
  "seedance-2-extend:8s:480p": 26,
  "seedance-2-extend:12s:480p": 38,
  "seedance-2-extend:15s:480p": 47,
  "seedance-2-extend:4s:720p": 28,
  "seedance-2-extend:8s:720p": 53,
  "seedance-2-extend:12s:720p": 78,
  "seedance-2-extend:15s:720p": 97,
  "seedance-2-extend:4s:1080p": 41,
  "seedance-2-extend:8s:1080p": 78,
  "seedance-2-extend:12s:1080p": 116,
  "seedance-2-extend:15s:1080p": 144,
  "ltx-2.3-pro-retake:per-second": 4,
  "runway-kie": 3,               // (5s, 720p)
  // ── Video Extend ──
  "veo-extend": 19,              // (VEO 3.1 Fast default)
  "veo-extend:quality": 79,      // (VEO 3.1 Quality)
  "runway-extend": 32,           // (Runway extend)
  // ── VEO Upscale ──
  "veo-1080p": 2,                // (VEO 3.1 1080p)
  "veo-4k": 38,                  // (VEO 3.1 4K)
  // ── Video-to-Video / Motion ──
  "wan": 18,                     // (V2V 5s 720p)
  "wan-flash": 13,               // est (Flash V2V, faster)
  "wan-videoedit": 32,
  "wan-t2v": 27,                 // (T2V 5s 1080p default)
  "wan-turbo-t2v": 20,           // (T2V 5s 720p default)
  // Wan 2.7 T2I — 1K/2K/4K (estimated, adjust after audit-credits post-ship)
  "wan-2.7": 2,        // (1K default)
  "wan-2.7:2K": 4,     // ( est.)
  "wan-2.7:4K": 8,    // ( est.)

  // Wan 2.7 Pro T2I — 1K/2K/4K (estimated)
  "wan-2.7-pro": 3,        // (1K)
  "wan-2.7-pro:2K": 6,     // ( est.)
  "wan-2.7-pro:4K": 12,    // ( est.)

  // ⚠️ UNDERCHARGE (deferred — needs owner cost data): the wan-2.7-i2v/t2v and
  // happyhorse/-i2v/-ref2v entries below are FLAT prices for "5s 720p", but the
  // nodes expose 2–15s (wan-2.7) / 3–15s (happyhorse) durations and 720p/1080p
  // (KIE default 1080p). These providers are NOT in DURATION_PRICED_PROVIDERS /
  // VIDEO_DURATION_TIERS / the resolution-tier sets (model-constants.ts), so
  // buildVideoCreditModelIdentifier returns the bare key and any duration/res is
  // charged the 5s-720p flat rate — an undercharge vs KIE (the sibling wan-i2v
  // correctly tiers 5/10/15s). FIX requires KIE's actual per-duration/per-1080p
  // rates for wan-2.7 + happyhorse (NOT published in the OpenAPI docs / dashboard
  // only); do NOT guess linear — if KIE bills flat-per-generation, linear tiers
  // would OVERCHARGE users on long clips. Wire tiers + composite keys (mirror
  // wan-i2v / seedance-2) once rates are confirmed, then run `audit-credits`.

  // Wan 2.7 I2V (estimated)
  "wan-2.7-i2v": 19,    // (5s 720p)

  // Wan 2.7 T2V (estimated)
  "wan-2.7-t2v": 19,    // (5s 720p)

  // HappyHorse (estimated)
  "happyhorse": 13,        // (5s 720p)
  "happyhorse-i2v": 13,    // (5s 720p)
  "happyhorse-ref2v": 15,  // (5s 720p)
  "happyhorse-edit": 20,
  "luma-modify": 32,             // (not in KIE pricing data)
  "runway-aleph": 35,             // (V2V conversion)
  "topaz-video": 19,             // (12 cr/sec * ~5s)
  // ── Motion Transfer (per-second pricing, duration-tiered) ──
  // Kling 3.0 720p: /sec
  "kling-3.0-motion": 30,        // 10s default
  "kling-3.0-motion:5s": 15,
  "kling-3.0-motion:10s": 30,
  "kling-3.0-motion:15s": 45,
  "kling-3.0-motion:30s": 90,
  // Kling 3.0 1080p: /sec
  "kling-3.0-motion:1080p": 50,  // 10s default
  "kling-3.0-motion:1080p:5s": 25,
  "kling-3.0-motion:1080p:10s": 50,
  "kling-3.0-motion:1080p:15s": 75,
  "kling-3.0-motion:1080p:30s": 150,
  // Kling 2.6 720p: /sec
  "motion-transfer": 15,         // 10s default:, (Kling 2.6 720p)
  "kling-motion": 15,            // alias
  "motion-transfer:5s": 8,
  "motion-transfer:10s": 15,
  "motion-transfer:15s": 23,
  "motion-transfer:30s": 45,
  // Kling 2.6 1080p: /sec
  "motion-transfer:1080p": 23,   // 10s default
  "motion-transfer:1080p:5s": 12,
  "motion-transfer:1080p:10s": 23,
  "motion-transfer:1080p:15s": 34,
  "motion-transfer:1080p:30s": 68,
  // Wan Animate (Move + Replace) — resolution-tiered pricing
  "wan-animate-move": 26,         // (480p default, actual from audit)
  "wan-animate-move:580p": 33,    // (interpolated from audit)
  "wan-animate-move:720p": 41,    // (actual from audit)
  "wan-animate-replace": 26,      // (480p default, same as move)
  "wan-animate-replace:580p": 33, // (interpolated)
  "wan-animate-replace:720p": 41, // (same as move)
  // ── Lip Sync ──
  // Kling AI Avatar 2.0 (May 2026) supports up to 5min audio, billed per-second
  // by KIE at 8 cr/sec (Standard, 720p) and 16 cr/sec (Pro, 1080p).
  // Composite identifiers `<provider>:<bucket>s` map to ceil(bucket × Nodaro-rate).
  // Nodaro rates: 2 cr/sec Standard, 4 cr/sec Pro (matches pre-upgrade ~14s flat).
  // Bare keys remain for back-compat — callers without audioDurationSec hit them.
  "kling-avatar": 28,             // legacy default ~14s
  "kling-avatar:15s": 30,         // 15s × 2 cr/sec
  "kling-avatar:30s": 60,         // 30s × 2 cr/sec
  "kling-avatar:60s": 120,        // 60s × 2 cr/sec
  "kling-avatar:120s": 240,       // 120s × 2 cr/sec
  "kling-avatar:300s": 600,       // 300s × 2 cr/sec — 5-min ceiling
  "kling-avatar-pro": 56,         // legacy default ~14s
  "kling-avatar-pro:15s": 60,     // 15s × 4 cr/sec
  "kling-avatar-pro:30s": 120,    // 30s × 4 cr/sec
  "kling-avatar-pro:60s": 240,    // 60s × 4 cr/sec
  "kling-avatar-pro:120s": 480,   // 120s × 4 cr/sec
  "kling-avatar-pro:300s": 1200,  // 300s × 4 cr/sec — 5-min ceiling
  // OmniHuman 1.5 — /sec → ceil(27×s/4). Bare = worst-case 60s
  // (reserved on unknown-duration workflow runs; reconciled down by the worker).
  "omnihuman-1-5": 405,
  "omnihuman-1-5:15s": 102,
  "omnihuman-1-5:30s": 203,
  "omnihuman-1-5:60s": 405,
  // HeyGen Lipsync Precision + Sync Lipsync 2 Pro (Replicate, video-input dubbing).
  // Billed per second of output; bucketed like kling-avatar via buildLipSyncCreditId.
  // At-cost (0% markup): credits. lip-sync
  // sets no meteredCost, so the worker commits the reserved bucket as the charge.
  "heygen-lipsync-precision": 1001,      // bare = 300s ceiling
  "heygen-lipsync-precision:15s": 51,    // 15s ×
  "heygen-lipsync-precision:30s": 101,   // 30s ×
  "heygen-lipsync-precision:60s": 201,   // 60s ×
  "heygen-lipsync-precision:120s": 401,  // 120s ×
  "heygen-lipsync-precision:300s": 1001, // 300s × — 5-min ceiling
  "lipsync-2-pro": 1249,                 // bare = 300s ceiling
  "lipsync-2-pro:15s": 63,               // 15s ×
  "lipsync-2-pro:30s": 125,              // 30s ×
  "lipsync-2-pro:60s": 250,              // 60s ×
  "lipsync-2-pro:120s": 500,             // 120s ×
  "lipsync-2-pro:300s": 1249,            // 300s × — 5-min ceiling
  // Sync Lipsync v3 (fal.ai). /min, billed per output second
  // bucketed via buildLipSyncCreditId. At-cost (0% markup): credits =
  // . lip-sync sets no meteredCost, so the
  // reserved bucket is committed verbatim as the charge.
  "sync-lipsync-v3": 2000,               // bare = 300s ceiling
  "sync-lipsync-v3:15s": 100,            // 15s ×
  "sync-lipsync-v3:30s": 200,            // 30s ×
  "sync-lipsync-v3:60s": 400,            // 60s ×
  "sync-lipsync-v3:120s": 800,           // 120s ×
  "sync-lipsync-v3:300s": 2000,          // 300s × — 5-min ceiling
  // Volcengine video-to-video lip sync (KIE). (/sec) — identical
  // to kling-avatar — billed per output second, bucketed via buildLipSyncCreditId.
  // At-cost (matches kling-avatar + the per-second lip-sync family): credits =
  // = 2 cr/sec. lip-sync sets no meteredCost, so
  // the reserved bucket is committed verbatim as the charge.
  "volcengine-lipsync": 600,             // bare = 300s ceiling
  "volcengine-lipsync:15s": 30,          // 15s ×
  "volcengine-lipsync:30s": 60,          // 30s ×
  "volcengine-lipsync:60s": 120,         // 60s ×
  "volcengine-lipsync:120s": 240,        // 120s ×
  "volcengine-lipsync:300s": 600,        // 300s × — 5-min ceiling
  // ── Replicate MMAudio (video-sfx node) ──
  // BASE credits (pre-markup). creditGuard applies cost_markup_percent at request time.
  "replicate-mmaudio":       1,  // base/legacy default (8s bucket)
  "replicate-mmaudio:8s":    1,
  "replicate-mmaudio:15s":   1,
  "replicate-mmaudio:30s":   2,
  "replicate-mmaudio:60s":   3,
  "replicate-mmaudio:120s":  5,
  "replicate-mmaudio:300s": 11,
  "hailuo-avatar": 19,           // estimated (not in KIE pricing data)
  // ── Audio / TTS / Music ──
  "elevenlabs-v3": 3,             // direct ElevenLabs API
  "elevenlabs-turbo": 2,         // per 1K chars
  "elevenlabs-multilingual": 3,  // per 1K chars
  "elevenlabs": 2,               // alias for turbo
  "elevenlabs-sfx": 1,           // 0.24 cr/sec * ~5s
  // Replicate disabled
  // "tangoflux": 4, // Replicate SFX, estimated
  "suno": 3,                     // (V4 default) — 0%-base
  "suno-v5": 3,                  // (V5)
  "suno-v5_5": 3,                // (V5.5)
  "suno-generate": 3,            // (V4 default)
  "suno-cover": 3,
  "suno-extend": 3,
  "suno-lyrics": 1,
  "suno-separate": 4,            // matches model_pricing (mig 059); held by re-baseline (unclear)
  "suno-separate-stem": 13,      // 0%-base
  "audio-separation": 3,         // Demucs (ryan5453) on Replicate, fixed reserved tier (Auto/Fast)
  "audio-separation:best": 8,    // htdemucs_ft (~4× compute), fixed reserved tier
  "audio-separation:stems": 6,   // htdemucs_6s (6-stem, heavier than base) — conservative estimate, tune via audit-credits
  "suno-music-video": 1,         // matches model_pricing (mig 059)
  "suno-mashup": 3,
  "suno-replace-section": 2,
  "suno-style-boost": 1,
  "suno-add-instrumental": 3,
  "suno-add-vocals": 3,
  "suno-convert-wav": 1,
  "suno-upload-extend": 3,
  "suno-voice-create": 20,       // One-time persona creation (validate + generate); KIE does not publish pricing — flat conservative default
  // Replicate disabled
  // "musicgen": 7,                 // Replicate Meta MusicGen
  // "lyria": 7,                    // Replicate Google Lyria 2
  // "bark": 7,                     // Replicate Suno Bark
  "elevenlabs-isolation": 8,     // /sec, variable; ~148s avg = (from audit)
  // Replicate disabled
  // "whisper": 4,                   // Replicate whisper transcription
  // "incredibly-fast-whisper": 4,   // Replicate fast whisper
  "elevenlabs-stt": 3,           // avg (from audit)
  "elevenlabs-dialogue": 4,     // per 1K chars
  "voice-clone": 5,              // ElevenLabs instant voice clone
  "elevenlabs-voice-changer": 4,  // ElevenLabs speech-to-speech
  "elevenlabs-dubbing": 8,        // ElevenLabs dubbing (async)
  "elevenlabs-voice-remix": 4,    // ElevenLabs voice remix/preview
  "elevenlabs-voice-design": 5,   // ElevenLabs voice design (full controls)
  "elevenlabs-forced-alignment": 3, // ElevenLabs forced alignment
  "infinitalk": 42,              // fallback (720p default)
  "infinitalk:480p": 11,         // (3 cr/sec * ~14s)
  "infinitalk:720p": 42,         // (12 cr/sec * ~14s)
  // ── Speech-to-Video ──
  "speech-to-video": 3,           // (480p)
  "speech-to-video:580p": 5,
  "speech-to-video:720p": 6,
  // ── Processing ──
  "topaz": 1,                     // processing
  "ffmpeg": 1,
  "render-video": 5,            // Remotion compute
  // Replicate disabled
  // "runway": 20, // Replicate, typical
  // "pika": 20, // Replicate, typical
  // ── LLM (standard tier = base entry, economy = 0.5x min 1, premium = 3x) ──
  "prompt-helper": 2,            // standard
  "prompt-helper:economy": 1,
  "prompt-helper:premium": 3,    // 0%-base (Opus 4.7)
  "ai-writer": 3,                // standard (0%-base)
  "ai-writer:economy": 1,
  "ai-writer:premium": 4,        // Opus 4.7
  "llm-chat": 2,                 // standard (0%-base)
  "llm-chat:economy": 1,
  "llm-chat:premium": 3,         // Opus 4.7
  "translate": 1,                // internal utility (replicate i2i prompt translation)
  "translate:economy": 1,
  "translate:premium": 1,
  "scene-graph-ai": 3,          // standard
  "scene-graph-ai:economy": 1,
  "scene-graph-ai:premium": 4,
  "video-composer": 3,          // standard
  "video-composer:economy": 1,
  "video-composer:premium": 4,
  "after-effects": 2,           // standard
  "after-effects:economy": 1,
  "after-effects:premium": 2,
  "lottie-overlay": 2,          // standard
  "lottie-overlay:economy": 1,
  "lottie-overlay:premium": 2,
  "3d-title": 2,                // standard
  "3d-title:economy": 1,
  "3d-title:premium": 4,
  "motion-graphics": 2,         // standard
  "motion-graphics:economy": 1,
  "motion-graphics:premium": 3,
  "motion-graphics-lottie": 5,         // standard (Sonnet 4.6, ~3K in + 4K out)
  "motion-graphics-lottie:economy": 1,
  "motion-graphics-lottie:premium": 8, // Opus 4.7 at the lottie token profile
  "composite": 0,
  "sub-workflow": 0,
  // ── Inline / control nodes — pure in-process logic, no provider cost (0cr).
  //    These mirror node-executor.ts INLINE_NODES. The 2026-05 hard-fail pricing
  //    policy (getModelCreditBaseCost) throws on ANY unconfigured identifier, so
  //    every free inline node needs an explicit 0 entry — otherwise a pipeline
  //    path that prices the node by its bare type stalls with
  //    PriceNotConfiguredError (prod 2026-05-27: shot-list scene generation hit
  //    bare "split-text"). composite / router / sub-workflow are covered nearby.
  "combine-text": 0,
  "split-text": 0,
  "extract-field": 0,
  "json-process": 0,
  "filter-list": 0,
  "deduplicate": 0,
  "merge-lists": 0,
  "sort-list": 0,
  "selector": 0,
  "webhook-output": 0,
  "preview": 0,
  "teleport-send": 0,
  "teleport-receive": 0,
  // ── Reduce (fan-in) — strategy-tiered pricing ──
  // Pure logic strategies are free; pick-best-llm pays for an LLM ranking call.
  // The composite key is built from the node's `data.strategyId` via the
  // CREDIT_COSTS["reduce"] resolver below. There is no base "reduce" entry —
  // the route always reads strategyId and resolves to a composite identifier.
  "reduce:pick-best-llm": 1,
  "reduce:concat": 0,
  "reduce:first-non-empty": 0,
  "reduce:count": 0,
  "reduce:vote": 0,
  "reduce:merge-json": 0,
  // ── Node types (additional entries for workflow estimation by node.type) ──
  "generate-script": 2,
  "generate-script:economy": 1,
  "generate-script:premium": 3,
  // ── Video Director (HyperFrames Phase 1) — fixed model: claude-sonnet-4.6 (standard) ──
  // No :economy/:premium composites — the authoring model is not user-selectable.
  // Math: ~6K input × /M + ~8K output × /M = → × → ceil = 9
  "video-director": 9,
  "generate-image": 2,
  "edit-image": 2,
  "image-to-image": 2,
  "modify-image": 2,
  "upscale-image": 1,
  "remove-background": 1,
  "image-to-video": 25,
  "video-to-video": 25,
  "text-to-video": 25,
  "text-to-speech": 3,
  "generate-music": 18,
  "text-to-audio": 3,
  "lip-sync": 13,
  "latentsync": 4,
  "wav2lip": 1,
  "video-retalking": 20,
  "sadtalker": 5,
  "video-upscale": 15,
  "extend-video": 40,
  // LTX 2.3 Pro retake — fallback for node-registry display and any
  // defensive lookups when the route's computeCredits hook isn't reached.
  // Real reservation uses `ltx-2.3-pro-retake:per-second × retakeDuration`.
  "video-retake": 100,
  "roop-face-swap": 13,           // Replicate ×
  "generate-mask": 5,             // adirik/grounded-sam (Replicate) — segmentation mask
  "transcribe": 1,
  // ── Web Scrape (Apify + direct RSS) ──
  "web-scrape": 2,
  "web-scrape:google-search": 3,
  "web-scrape:content-crawler": 1,
  "web-scrape:content-crawler:site": 5,
  "web-scrape:instagram": 1,
  "web-scrape:tiktok": 1,
  "web-scrape:rss": 1,
  "qa-check": 1,
  "qa-check:economy": 1,
  "qa-check:premium": 1,
  // ── Dynamic-priced video utilities (NOT used by routes, but kept as
  //    safety-net fallback). The three rows below are unreachable when
  //    routes/loop-video.ts, routes/trim-video.ts, routes/combine-videos.ts
  //    use the computeCredits hook in creditGuard. Their model_pricing rows
  //    (also 0) are likewise unreachable.
  "combine-videos": 3,
  // Image Collage — composites N images into one 2K/4K image (local ffmpeg,
  // no provider cost). Priced by resolution. Base + resolution composites;
  // the single-node route uses computeCredits, workflow runs reserve the
  // composite via the payload-builder modelIdentifier. See migration 244.
  "image-collage": 2,
  "image-collage:2K": 2,
  "image-collage:4K": 4,
  // Assemble Narrated Video — fits N ordered (clip, voice) blocks into one
  // MP4 via ffmpeg (local compute, no external provider cost). BASE credits
  // (pre-markup) is the 6-block case: 3 + ceil = 4. The route scales
  // with block count via computeCredits (assembleNarratedVideoCredits).
  // See migration 246.
  "assemble-narrated-video": 4,
  "merge-video-audio": 2,
  "add-captions": 3,
  "add-captions:kinetic": 5,
  "resize-video": 2,
  "trim-audio": 1,
  "split-media": 2,
  "extract-audio": 1,
  "remove-audio": 2,
  "mix-audio": 2,
  "combine-audio": 1,
  "adjust-volume": 1,
  "audio-fx": 2,                  // Demucs-free FFmpeg audio effects (reverb/EQ/echo)
  "trim-video": 1,
  "extract-frame": 1,
  "speed-ramp": 2,
  "speed-ramp:smooth": 5, // motion-compensated interpolation (minterpolate) — 5-20x slower than fast
  "loop-video": 1,
  "fade-video": 1,
  "transcode-video": 1,
  "audio-isolation": 8,          // alias for elevenlabs-isolation
  "text-to-dialogue": 4,
  "image-to-text": 1,
  "image-to-text:economy": 1,
  "image-to-text:premium": 1,
  "describe-to-picker": 1,
  "describe-to-picker:economy": 1,
  "describe-to-picker:premium": 1,
  "image-critic": 1,
  "image-critic:economy": 1,
  "image-critic:premium": 2,
  "character": 2,
  "object": 2,
  "location": 2,
  "voice-changer": 4,
  "voice-changer-pro": 4,              // [comment removed]
  "dubbing": 8,
  "voice-remix": 4,
  "voice-design": 5,
  "forced-alignment": 3,
  "social-media-format": 2,
  "social-publish": 1,
  "instagram-post": 1,
  "tiktok-post": 1,
  "youtube-upload": 1,
  "linkedin-post": 1,
  "x-post": 1,
  "facebook-post": 1,
  "telegram-post": 1,
  "save-to-storage": 0,
  "router": 0,
  "component": 0,               // Component node itself is free; inner nodes have their own costs
  // ── Generative Pipeline (Story-to-Video) ──
  // Pipeline orchestration is variable-cost — the upfront estimate is set per run.
  // These are FALLBACK costs the credit-guard uses when an estimate isn't supplied
  // (defensive — the route always supplies one). Number chosen as the median Phase 1A
  // Stage 1-only run (Detection + Showrunner + 2 critics ≈ 30 credits).
  "pipeline-orchestration": 30,
  "pipeline-orchestration:stage_1_only": 30,
  // The editor's GenerativePipelineConfig + node-toolbar call POST
  // /v1/credits/model-costs with the node-type slug ("generative-pipeline")
  // to display the credit estimate. Without an entry here OR a DB row the
  // lookup throws PriceNotConfiguredError → 503. The actual per-run cost
  // is computed by estimateUpfrontCredits (duration × format × mode), so
  // this static row is a UI display fallback only — it's NOT the value
  // charged at run time.
  "generative-pipeline": 30,
  // Phase 2 (granular-pipeline-control): per-call Showrunner refine of a
  // single scene from the ScriptPanel "Regenerate this scene" button.
  // Charged per click — flat 3 credits (1 LLM call, single-SceneSpec emit,
  // actual cost @ Sonnet 4.6 + buffer).
  "regenerate-scene": 3,
  // ── Scene-Context Helpers (Phase 1B.3, §6.11) ──
  // Per-call LLM micro-actions invoked from a SceneNode's context panel.
  // Reserve/refund via backend/src/ee/pipelines/scene-helper-credits.ts.
  // DB source-of-truth: supabase/migrations/130_seed_scene_helper_pricing.sql.
  "scene-helper:audit_prompt": 1,
  "scene-helper:improve_prompt": 2,
  "scene-helper:generate_motion": 1,
  "scene-helper:optimize_for_model": 2,
  "scene-helper:add_broll": 2,
  "scene-helper:bridge_to_next_scene": 2,
  "scene-helper:anchor_scene_style": 2,
  // Phase 1C.1 vision-keyframe helpers — DB row in migration 134.
  // Audit Images: 1 Sonnet vision call per shot (≤8 shots). 3cr covers the
  // amortized average. Validate Match Cut: 1 Sonnet vision call with 2 images.
  // Fix Continuity: 1 Sonnet vision call + (conditional) image regen via
  // pipelineGenerateImage; 4cr covers the critic + 1cr buffer over the cheap
  // image_model regen (e.g. nano-banana). All 3 entries are added together
  // so the credit-pricing-migration-sync REVERSE-direction test stays green
  // (migration 134 seeds all 3 model_pricing rows in one statement).
  "scene-helper:audit_images": 1,
  "scene-helper:fix_continuity": 1,
  "scene-helper:validate_match_cut": 1,
  // Phase 1C.2 Stage 7 sub-steps — DB rows in migration 135.
  // Editor LLM: one Sonnet vision call per pipeline (3cr). Beat-grid extract:
  // pure FFmpeg/aubio post-process, no LLM/provider cost (0cr). Music timeline:
  // 4cr covers the Suno gen wrapper overhead (the Suno cost is reserved
  // separately via the Suno worker). Final merge: 3cr for the FFmpeg combine
  // pass with cut decisions + music overlay. FreeCut export: pure JSON
  // generation, no provider cost (0cr).
  "pipeline-editor-llm": 3,
  "pipeline-beat-grid-extract": 0,
  "pipeline-music-timeline": 4,
  "pipeline-final-merge": 3,
  "pipeline-freecut-export": 0,
  // ── Beeble SwitchX relight — 30-frame-block × resolution reserve holds ──
  // 17 ids: bare (= 240f/1080p worst-case) + 8 block tiers (30/60/90/120/150/
  // 180/210/240, SWITCHX_FRAME_TIERS) × 2 resolutions (720/1080p). ANCHORED to
  // Beeble's published rate 2026-06-26 (developer.beeble.ai/pricing): metered per
  // 30-frame block — 720p f, 1080p f — committed verbatim. AT-COST
  // (no platform margin): block credits = blockUSD / @720p, 15 @1080p.
  // Tiers are 30-frame multiples so each snaps to the exact block Beeble bills
  // (ceil(frames/30)). Mirrors migration 241 rows (credit-pricing-migration-sync).
  "beeble-switchx": 120,
  "beeble-switchx:30f:1080p": 15,
  "beeble-switchx:30f:720p": 5,
  "beeble-switchx:60f:1080p": 30,
  "beeble-switchx:60f:720p": 10,
  "beeble-switchx:90f:1080p": 45,
  "beeble-switchx:90f:720p": 15,
  "beeble-switchx:120f:1080p": 60,
  "beeble-switchx:120f:720p": 20,
  "beeble-switchx:150f:1080p": 75,
  "beeble-switchx:150f:720p": 25,
  "beeble-switchx:180f:1080p": 90,
  "beeble-switchx:180f:720p": 30,
  "beeble-switchx:210f:1080p": 105,
  "beeble-switchx:210f:720p": 35,
  "beeble-switchx:240f:1080p": 120,
  "beeble-switchx:240f:720p": 40,
}

// ============================================================
// Composite Credit Identifier Resolvers (per-node-type)
// ============================================================
//
// Node-type → resolver(data) → composite identifier string.
//
// When a node's credit cost depends on a runtime config field (e.g. Reduce's
// `strategyId`) the route's `creditGuard` resolver calls into this map to
// build the composite key, which is then looked up in `STATIC_CREDIT_COSTS`
// (or the `model_pricing` DB table) the same way provider+quality composites
// like `gpt-image:high` are resolved.
//
// Image/video providers historically build their composites via
// `buildCreditModelIdentifier()` / `buildVideoCreditModelIdentifier()` in
// `@nodaro/shared` (kept there because frontend mirrors the logic). This
// `CREDIT_COSTS` map is for node-type-level resolvers that don't fit that
// provider+quality shape — anything where the node's *strategy* or *mode*
// drives the price.

export const CREDIT_COSTS: Record<string, (data: Record<string, unknown>) => string> = {
  // Reduce (fan-in): composite key = `reduce:<strategyId>`. Default to
  // `concat` (the cheapest pure-logic strategy) when strategyId is absent.
  "reduce": (data) => `reduce:${(data as { strategyId?: string }).strategyId ?? "concat"}`,

  // AI Avatar (HeyGen): delegates to resolveAiAvatarCreditId — same body-reading
  // logic the creditGuard preHandler uses directly at request time.
  "ai-avatar": (data) => resolveAiAvatarCreditId(data),

  // Cinematic Avatar (HeyGen): delegates to resolveCinematicCreditId — exact
  // (resolution, duration) id, same logic the creditGuard preHandler uses.
  "cinematic-avatar": (data) => resolveCinematicCreditId(data),

  // Beeble SwitchX relight: delegates to resolveSwitchXCreditId — builds the
  // `beeble-switchx:<tier>f:<res>p` composite from the ffprobed frame count
  // (__probedFrameCount) + maxResolution, same logic the creditGuard preHandler
  // uses at request time.
  "switchx": (data) => resolveSwitchXCreditId(data),
}

// Tier order for restriction checks
const TIER_ORDER = ["free", "basic", "standard", "pro", "business"]

// ============================================================
// Helper Functions
// ============================================================

/**
 * Check if credit system is disabled (community or business edition)
 */
function creditsDisabled(): boolean {
  return !hasCredits()
}

/**
 * Resolve the user's tier from profile, checking both `tier` and `subscription_tier`
 * columns for backward compatibility.
 */
function resolveTier(profile: Record<string, unknown>): string {
  return (profile.tier as string) ?? (profile.subscription_tier as string) ?? "free"
}

/**
 * Check if daily_spent_credits needs resetting (new UTC day).
 * Returns the effective daily spent value (0 if reset needed).
 * Uses atomic RPC with FOR UPDATE lock to prevent race conditions at midnight.
 */
async function getEffectiveDailySpent(
  userId: string,
  currentDailySpent: number,
  lastReset: string | null
): Promise<number> {
  const todayUTC = new Date().toISOString().slice(0, 10)
  const lastResetDay = lastReset ? lastReset.slice(0, 10) : null

  if (lastResetDay !== todayUTC) {
    // Atomic reset via RPC (FOR UPDATE lock prevents race at midnight)
    const { data, error } = await supabase.rpc("reset_daily_spent_if_needed", {
      p_user_id: userId,
    })
    if (!error && data !== null && data !== undefined) {
      return data as number
    }
    // Fallback: non-atomic reset if RPC not available
    await supabase
      .from("profiles")
      .update({
        daily_spent_credits: 0,
        last_daily_reset: new Date().toISOString().slice(0, 10),
      })
      .eq("id", userId)
    return 0
  }

  return currentDailySpent
}

// ============================================================
// TTL Cache — reusable map with time-based expiration
// ============================================================

class TtlCache<T> {
  private readonly entries = new Map<string, T>()
  private expiresAt = 0

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    if (Date.now() >= this.expiresAt) {
      this.entries.clear()
      return undefined
    }
    return this.entries.get(key)
  }

  set(key: string, value: T): void {
    if (Date.now() >= this.expiresAt) {
      this.entries.clear()
      this.expiresAt = Date.now() + this.ttlMs
    }
    this.entries.set(key, value)
  }

  invalidate(): void {
    this.entries.clear()
    this.expiresAt = 0
  }
}

// ── Model pricing cache (60s TTL) ──

export interface ModelPricing {
  creditCost: number
  isEnabled: boolean
  tierRestriction: string | null
}

const modelPricingCache = new TtlCache<ModelPricing>(60_000)

/**
 * Invalidate the model pricing cache (e.g. after admin updates model_pricing table)
 */
export function invalidateModelPricingCache(): void {
  modelPricingCache.invalidate()
}

/**
 * Returns the PRE-MARKUP base cost for a model (cached 60s).
 *
 * Use this when the caller will apply markup separately (e.g. routes
 * composing dbCost + addon via the creditGuard computeCredits hook).
 * For most callers, prefer getModelCreditCostFromDB which returns
 * post-markup values matching what the user is charged.
 *
 * **Throws `PriceNotConfiguredError`** if the identifier has no row in the
 * `model_pricing` table AND no entry in `STATIC_CREDIT_COSTS`. Per the
 * 2026-05 hard-fail policy, pricing misconfig must fail loudly — we no
 * longer silently default to 1 credit (which leaked revenue on missing
 * entries like `seedance-2:8s:1080p-ref`).
 */
export async function getModelCreditBaseCost(modelIdentifier: string): Promise<ModelPricing> {
  const cached = modelPricingCache.get(modelIdentifier)
  if (cached) return cached

  const { data, error } = await supabase
    .from("model_pricing")
    .select("credit_cost, is_enabled, tier_restriction")
    .eq("model_identifier", modelIdentifier)
    .single()

  let base: ModelPricing
  if (error || !data) {
    const staticCost = STATIC_CREDIT_COSTS[modelIdentifier]
    if (staticCost === undefined) {
      console.error(
        `[credits] PriceNotConfiguredError: unknown model identifier "${modelIdentifier}" — ` +
          `no row in model_pricing AND no STATIC_CREDIT_COSTS entry. ` +
          `This is a misconfiguration — see CLAUDE.md "Provider Enum Sync" steps 7 + 9.`,
      )
      throw new PriceNotConfiguredError(modelIdentifier)
    }
    base = { creditCost: staticCost, isEnabled: true, tierRestriction: null }
  } else {
    base = { creditCost: data.credit_cost, isEnabled: data.is_enabled, tierRestriction: data.tier_restriction }
  }
  modelPricingCache.set(modelIdentifier, base)
  return base
}

/**
 * Get credit cost for a model from database, falling back to static costs.
 * Base costs are cached for 60s. The cost_markup_percent from admin settings
 * is applied on top: finalCost = ceil(baseCost * (1 + markup/100)).
 * Both DB values and STATIC_CREDIT_COSTS represent base costs at 0% markup.
 */
export async function getModelCreditCostFromDB(modelIdentifier: string): Promise<ModelPricing> {
  const base = await getModelCreditBaseCost(modelIdentifier)
  // Apply markup from admin settings (cached 60s separately)
  const settings = await getAppSettings()
  if (settings.cost_markup_percent > 0 && base.creditCost > 0) {
    return {
      ...base,
      creditCost: Math.ceil(base.creditCost * (1 + settings.cost_markup_percent / 100)),
    }
  }
  return base
}

// ── Tier config cache (60s TTL) ──

interface TierConfig {
  daily_credit_limit: number | null
  monthly_credits: number | null
  features: Record<string, unknown> | null
}

const tierConfigCache = new TtlCache<TierConfig>(60_000)

async function getTierConfig(tier: string): Promise<TierConfig> {
  const cached = tierConfigCache.get(tier)
  if (cached) return cached

  const { data } = await supabase
    .from("tier_config")
    .select("daily_credit_limit, monthly_credits, features")
    .eq("tier", tier)
    .single()

  const result: TierConfig = {
    daily_credit_limit: data?.daily_credit_limit ?? null,
    monthly_credits: data?.monthly_credits ?? null,
    features: (data?.features as Record<string, unknown>) ?? null,
  }

  tierConfigCache.set(tier, result)
  return result
}

// ============================================================
// Credits Service
// ============================================================

export class CreditsService {
  /**
   * Log a credit transaction (never throws -- errors are logged silently)
   */
  static async logTransaction(params: {
    userId: string
    amount: number
    creditType: "subscription" | "topup"
    source: "subscription_created" | "subscription_renewal" | "one_time_purchase" | "admin_adjustment" | "usage" | "refund" | "stripe_refund" | "expiry"
    description?: string
    jobId?: string
    stripeTransactionId?: string
    adminUserId?: string
    balanceAfter: number
  }): Promise<boolean> {
    try {
      const { error } = await supabase
        .from("credit_transactions")
        .insert({
          user_id: params.userId,
          amount: params.amount,
          credit_type: params.creditType,
          source: params.source,
          description: params.description || null,
          job_id: params.jobId || null,
          stripe_transaction_id: params.stripeTransactionId || null,
          admin_user_id: params.adminUserId || null,
          balance_after: params.balanceAfter,
        })
      if (error) {
        console.error("[credits] Failed to log transaction:", error)
        return false
      }
      return true
    } catch (err) {
      console.error("[credits] Failed to log transaction:", err)
      return false
    }
  }

  /**
   * Admin: adjust a user's credits (add or remove)
   */
  static async adminAdjustCredits(params: {
    userId: string
    amount: number
    creditType: "subscription" | "topup"
    description: string
    adminUserId: string
  }): Promise<{ newBalance: number }> {
    if (creditsDisabled()) {
      return { newBalance: 999999 }
    }

    const field = params.creditType === "subscription" ? "subscription_credits" : "topup_credits"
    const otherField = params.creditType === "subscription" ? "topup_credits" : "subscription_credits"

    // Atomic update using SQL expression to avoid TOCTOU race condition.
    // GREATEST ensures credits never go below 0.
    const { data: updated, error: updateError } = await supabase
      .rpc("admin_adjust_credits" as string, {
        p_user_id: params.userId,
        p_field: field,
        p_amount: params.amount,
      })

    // Fallback if RPC doesn't exist yet: use read-then-write (existing behavior)
    let newValue: number
    let otherValue: number
    if (updateError) {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("subscription_credits, topup_credits")
        .eq("id", params.userId)
        .single()

      if (profileError || !profile) {
        throw new Error("User profile not found")
      }

      const currentValue = ((profile as Record<string, unknown>)[field] ?? 0) as number
      newValue = Math.max(0, currentValue + params.amount)
      otherValue = ((profile as Record<string, unknown>)[otherField] ?? 0) as number

      const { error: fallbackError } = await supabase
        .from("profiles")
        .update({ [field]: newValue })
        .eq("id", params.userId)

      if (fallbackError) {
        throw new Error(`Failed to update credits: ${fallbackError.message}`)
      }
    } else {
      // RPC returns the new values
      const result = updated as Record<string, number> | null
      newValue = (result?.[field] ?? 0) as number
      otherValue = (result?.[otherField] ?? 0) as number
    }

    const newTotal = newValue + otherValue

    await CreditsService.logTransaction({
      userId: params.userId,
      amount: params.amount,
      creditType: params.creditType,
      source: "admin_adjustment",
      description: params.description,
      adminUserId: params.adminUserId,
      balanceAfter: newTotal,
    })

    return { newBalance: newTotal }
  }

  /**
   * Check if user has sufficient credits (read-only check).
   * Enforces free tier restrictions: blocked models, daily credit cap.
   * Returns allowed: true for self-hosted mode.
   */
  static async checkCredits(
    userId: string,
    modelIdentifier: string,
    isAppRun?: boolean,
    creditOverride?: number,
  ): Promise<CreditCheckResult> {
    // Self-hosted: always allow
    if (creditsDisabled()) {
      return { allowed: true, balance: 999999, watermark: false }
    }

    // Get user's profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("tier, subscription_tier, subscription_credits, topup_credits, daily_spent_credits, last_daily_reset, app_credits_allowance")
      .eq("id", userId)
      .single()

    if (profileError || !profile) {
      return {
        allowed: false,
        error: "User profile not found",
      }
    }

    // `creditOverride` lets a caller (e.g. the orchestrator's Seedance 2
    // ref-video reservation) preflight the EXACT amount it will reserve, not the
    // base DB cost — so a balance between base and scaled never passes preflight
    // then fails at reserve.
    return CreditsService.checkCreditsWithProfile(userId, profile as CreditProfile, modelIdentifier, isAppRun, creditOverride)
  }

  /**
   * Check credits using a pre-fetched profile (avoids extra DB query).
   * The profile must include: tier, subscription_tier, subscription_credits,
   * topup_credits, daily_spent_credits, last_daily_reset.
   */
  static async checkCreditsWithProfile(
    userId: string,
    profile: CreditProfile,
    modelIdentifier: string,
    isAppRun?: boolean,
    creditOverride?: number,
  ): Promise<CreditCheckResult> {
    if (creditsDisabled()) {
      return { allowed: true, balance: 999999, watermark: false }
    }

    // When a route supplies a dynamic credit override, use it for the
    // creditCost while still respecting the DB row's isEnabled +
    // tierRestriction (admins disabling a model still wins).
    const dbPricing = await getModelCreditCostFromDB(modelIdentifier)
    const pricing = creditOverride !== undefined
      ? { ...dbPricing, creditCost: creditOverride }
      : dbPricing

    if (!pricing.isEnabled) {
      return {
        allowed: false,
        error: "This model is currently disabled",
      }
    }

    const userTier = resolveTier(profile as Record<string, unknown>)
    const isFree = userTier === "free"
    const watermark = isFree && FREE_TIER_RESTRICTIONS.watermark

    // Check tier restriction (from model_pricing table)
    if (pricing.tierRestriction) {
      const userTierIndex = TIER_ORDER.indexOf(userTier)
      const requiredTierIndex = TIER_ORDER.indexOf(pricing.tierRestriction)

      if (userTierIndex < requiredTierIndex) {
        return {
          allowed: false,
          error: `This model requires ${pricing.tierRestriction} tier or higher. Please upgrade your plan.`,
          watermark,
        }
      }
    }

    // Free tier: blocked models
    if (isFree) {
      const blockedModels = FREE_TIER_RESTRICTIONS.blockedModels as readonly string[]
      if (blockedModels.includes(modelIdentifier)) {
        return {
          allowed: false,
          error: "This model requires a paid subscription. Upgrade to Basic or higher.",
          watermark,
        }
      }
    }

    // Calculate total balance
    const subscriptionCredits = profile.subscription_credits ?? 0
    const topupCredits = profile.topup_credits ?? 0
    const totalBalance = subscriptionCredits + topupCredits

    // Check if user has enough credits
    if (totalBalance < pricing.creditCost) {
      return {
        allowed: false,
        error: `Insufficient credits. Required: ${pricing.creditCost}, Available: ${totalBalance}`,
        balance: totalBalance,
        required: pricing.creditCost,
        subscriptionCredits,
        topupCredits,
        watermark,
      }
    }

    // App run check: free tier users with no topup must have earned enough app allowance
    if (isAppRun && isFree && topupCredits === 0) {
      const appAllowance = profile.app_credits_allowance ?? 0
      if (appAllowance < pricing.creditCost) {
        return {
          allowed: false,
          error: `Insufficient app credits. You have ${appAllowance} app credits but need ${pricing.creditCost}. Earn app credits by running flows in the editor.`,
          balance: totalBalance,
          required: pricing.creditCost,
          appCreditsAllowance: appAllowance,
          watermark,
        }
      }
    }

    // Free tier: daily credit cap
    if (isFree) {
      const dailyCap = FREE_TIER_RESTRICTIONS.dailyCreditCap
      const dailySpent = await getEffectiveDailySpent(
        userId,
        profile.daily_spent_credits ?? 0,
        profile.last_daily_reset ?? null
      )

      if (dailySpent >= dailyCap) {
        return {
          allowed: false,
          error: `Daily credit limit reached for free tier. Limit: ${dailyCap}, Spent today: ${dailySpent}. Upgrade for higher limits.`,
          balance: totalBalance,
          required: pricing.creditCost,
          dailyLimit: dailyCap,
          dailySpent,
          watermark,
        }
      }

      return {
        allowed: true,
        balance: totalBalance,
        required: pricing.creditCost,
        subscriptionCredits,
        topupCredits,
        dailyLimit: dailyCap,
        dailySpent,
        watermark,
      }
    }

    // Paid tiers: check daily limit from tier_config if configured.
    // Use getEffectiveDailySpent (same as the free branch) so the counter is
    // reset on a new UTC day — reading raw daily_spent_credits would compare
    // today's first request against yesterday's spend and falsely 402-block,
    // even though the authoritative reserve_credits RPC resets it correctly.
    const tierConfig = await getTierConfig(userTier)
    const dailyLimit = tierConfig.daily_credit_limit ?? undefined
    const dailySpent = await getEffectiveDailySpent(
      userId,
      profile.daily_spent_credits ?? 0,
      profile.last_daily_reset ?? null
    )

    if (dailyLimit !== undefined && dailySpent + pricing.creditCost > dailyLimit) {
      return {
        allowed: false,
        error: `Daily credit limit reached. Limit: ${dailyLimit}, Spent: ${dailySpent}`,
        balance: totalBalance,
        required: pricing.creditCost,
        dailyLimit,
        dailySpent,
        watermark,
      }
    }

    return {
      allowed: true,
      balance: totalBalance,
      required: pricing.creditCost,
      subscriptionCredits,
      topupCredits,
      dailyLimit,
      dailySpent,
      watermark,
    }
  }

  /**
   * Reserve credits atomically using reserve_credits RPC.
   * Single RPC call: deducts credits (subscription first, then topup),
   * increments daily_spent, and creates usage_log — all in one transaction.
   */
  static async reserveCredits(
    userId: string,
    jobId: string,
    modelIdentifier: string,
    providerCostUsd: number,
    displayCostUsd: number,
    options?: { watermarkOverride?: boolean; isAppRun?: boolean; creditOverride?: number },
  ): Promise<ReserveResult> {
    // Self-hosted: skip reservation
    if (creditsDisabled()) {
      return { usageLogId: "self-hosted-skip", creditsReserved: 0, watermark: false }
    }

    const { watermarkOverride, isAppRun, creditOverride } = options ?? {}

    // Get credit cost: route-supplied override or DB lookup.
    const dbPricing = await getModelCreditCostFromDB(modelIdentifier)
    const pricing = creditOverride !== undefined
      ? { ...dbPricing, creditCost: creditOverride }
      : dbPricing
    // Fetch tier once — needed for the atomic daily cap below, and (unless
    // overridden) for the watermark decision.
    const { data: tierProfile } = await supabase
      .from("profiles")
      .select("tier, subscription_tier")
      .eq("id", userId)
      .single()
    const userTier = tierProfile ? resolveTier(tierProfile as Record<string, unknown>) : "free"
    const watermark = watermarkOverride !== undefined
      ? watermarkOverride
      : (userTier === "free" && FREE_TIER_RESTRICTIONS.watermark)

    // Daily credit cap, enforced atomically inside reserve_credits (closes the
    // TOCTOU the read-only creditGuard preHandler left open). Free tier uses the
    // fixed cap; paid tiers use their configured daily_credit_limit (null = no cap).
    const dailyLimit: number | null = userTier === "free"
      ? FREE_TIER_RESTRICTIONS.dailyCreditCap
      : (await getTierConfig(userTier)).daily_credit_limit

    // Skip deduction for zero-cost models
    if (pricing.creditCost === 0) {
      const { data: usageLog } = await supabase
        .from("usage_logs")
        .insert({
          user_id: userId,
          job_id: jobId,
          action: modelIdentifier,
          provider: "reserved",
          credits_used: 0,
          cost_usd: providerCostUsd,
          metadata: { status: "reserved", display_cost_usd: displayCostUsd },
        })
        .select("id")
        .single()

      return {
        usageLogId: usageLog?.id ?? "log-failed",
        creditsReserved: 0,
        watermark,
      }
    }

    // Atomic reservation via single RPC (deducts credits + increments daily spent + creates usage log)
    const { data: usageLogId, error: reserveError } = await supabase.rpc("reserve_credits", {
      p_user_id: userId,
      p_credits: pricing.creditCost,
      p_job_id: jobId,
      p_model_identifier: modelIdentifier,
      p_provider_cost_usd: providerCostUsd,
      p_display_cost_usd: displayCostUsd,
      p_is_app_run: isAppRun ?? false,
      p_daily_limit: dailyLimit,
    })

    if (reserveError) {
      console.error("[credits] reserve_credits RPC failed:", reserveError.message)
      throw new Error(`Credit reservation failed: ${reserveError.message}`)
    }

    if (!usageLogId) {
      console.error("[credits] reserve_credits returned null usage log ID")
      return { usageLogId: "log-failed", creditsReserved: pricing.creditCost, watermark }
    }

    // Fetch usage_log metadata (from_sub/from_topup) for accurate creditType,
    // and current user balance for accurate balanceAfter (C3 + H6 fix)
    let creditType: "subscription" | "topup" = "subscription"
    let balanceAfter = 0
    try {
      const [{ data: usageLog }, { data: balanceProfile }] = await Promise.all([
        supabase
          .from("usage_logs")
          .select("metadata")
          .eq("id", usageLogId)
          .single(),
        supabase
          .from("profiles")
          .select("subscription_credits, topup_credits")
          .eq("id", userId)
          .single(),
      ])
      const meta = usageLog?.metadata as Record<string, unknown> | null
      const fromSub = (meta?.from_sub as number) ?? 0
      const fromTopup = (meta?.from_topup as number) ?? 0
      if (fromTopup > 0 && fromSub === 0) {
        creditType = "topup"
      }
      if (balanceProfile) {
        balanceAfter = (balanceProfile.subscription_credits ?? 0) + (balanceProfile.topup_credits ?? 0)
      }
    } catch {
      // Non-critical: fall back to defaults if fetch fails
    }

    // Log credit transaction
    await CreditsService.logTransaction({
      userId,
      amount: -pricing.creditCost,
      creditType,
      source: "usage",
      description: `Job ${jobId}: ${modelIdentifier}`,
      jobId,
      balanceAfter,
    })

    return { usageLogId: usageLogId as string, creditsReserved: pricing.creditCost, watermark }
  }

  /**
   * Commit reserved credits after job success
   * Updates usage_log status to 'committed'
   */
  static async commitCredits(
    usageLogId: string,
    actualCredits?: number
  ): Promise<void> {
    if (creditsDisabled() || usageLogId === "self-hosted-skip") return

    // Try RPC first
    const { error: rpcError } = await supabase.rpc("commit_credits", {
      p_usage_log_id: usageLogId,
      p_actual_credits: actualCredits,
    })

    if (!rpcError) return

    // Fallback: manual commit. Update the canonical `status` column (the same
    // column the SQL `commit_credits`/`refund_credits` functions use), guarded
    // by status='reserved' so a concurrent commit/refund can't double-fire.
    console.warn("[credits] commit_credits RPC not found, using fallback")

    const { error } = await supabase
      .from("usage_logs")
      .update({ status: "committed" })
      .eq("id", usageLogId)
      .eq("status", "reserved")

    if (error) {
      console.error("[credits] Failed to commit credits:", error)
    }
  }

  /**
   * Refund reserved credits after job failure
   * Updates usage_log status to 'refunded' and restores credits
   */
  static async refundCredits(usageLogId: string): Promise<void> {
    if (creditsDisabled() || usageLogId === "self-hosted-skip") return

    // Try RPC first
    const { error: rpcError } = await supabase.rpc("refund_credits", {
      p_usage_log_id: usageLogId,
    })

    if (!rpcError) return

    // Fallback: manual refund
    console.warn("[credits] refund_credits RPC not found, using fallback")

    // Get the usage log to find credits to refund
    const { data: usageLog, error: logError } = await supabase
      .from("usage_logs")
      .select("user_id, job_id, credits_used, status, metadata")
      .eq("id", usageLogId)
      .single()

    if (logError || !usageLog) {
      console.error("[credits] Usage log not found for refund:", usageLogId)
      return
    }

    // Only `reserved` rows are eligible to refund. Already-committed or
    // already-refunded rows must not be touched (mirrors the SQL function's
    // `WHERE id = ? AND status = 'reserved'` guard).
    if (usageLog.status !== "reserved") {
      console.warn(`[credits] Skipping refund — usage log ${usageLogId} status is "${usageLog.status}"`)
      return
    }

    // Atomic claim: flip status reserved → refunded conditionally. If two
    // callers race here, exactly one matches a row; the other gets `null` and
    // returns without touching balances. Done BEFORE any credit restoration
    // so the balance mutation is gated behind a single-winner mutex.
    const { data: claimed, error: claimError } = await supabase
      .from("usage_logs")
      .update({ status: "refunded" })
      .eq("id", usageLogId)
      .eq("status", "reserved")
      .select("id")
      .maybeSingle()

    if (claimError) {
      console.error("[credits] Failed to claim refund slot:", usageLogId, claimError.message)
      return
    }
    if (!claimed) {
      console.warn("[credits] Refund slot already claimed (concurrent caller):", usageLogId)
      return
    }

    // Past this point we are the sole refunder; safe to restore balances.
    const meta = usageLog.metadata as Record<string, unknown> | null
    const fromSub = (meta?.from_sub as number) ?? 0
    const fromTopup = (meta?.from_topup as number) ?? 0

    // Restore subscription credits if any were deducted from that pool
    if (fromSub > 0) {
      const { error: subError } = await supabase.rpc("add_subscription_credits", {
        p_user_id: usageLog.user_id,
        p_credits: fromSub,
      })
      if (subError) {
        console.error("[credits] add_subscription_credits RPC failed for refund:", usageLogId, subError.message)
      }
    }

    // Restore topup credits if any were deducted from that pool
    if (fromTopup > 0) {
      const { error: topupError } = await supabase.rpc("add_topup_credits", {
        p_user_id: usageLog.user_id,
        p_credits: fromTopup,
      })
      if (topupError) {
        console.error("[credits] add_topup_credits RPC failed for refund:", usageLogId, topupError.message)
      }
    }

    // Fallback: if metadata didn't record pool split, restore all to topup
    if (fromSub === 0 && fromTopup === 0 && usageLog.credits_used > 0) {
      const { error: fallbackError } = await supabase.rpc("add_topup_credits", {
        p_user_id: usageLog.user_id,
        p_credits: usageLog.credits_used,
      })
      if (fallbackError) {
        console.error("[credits] Fallback add_topup_credits RPC failed:", usageLogId, fallbackError.message)
      }
    }

    // Determine creditType for transaction log based on which pool was dominant
    const refundCreditType: "subscription" | "topup" =
      fromSub > 0 && fromTopup === 0 ? "subscription" : "topup"

    await CreditsService.logTransaction({
      userId: usageLog.user_id,
      amount: usageLog.credits_used,
      creditType: refundCreditType,
      source: "refund",
      description: "Refund for failed job",
      jobId: usageLog.job_id ?? undefined,
      balanceAfter: 0,
    })
  }

  /**
   * Check if user is within their storage limit.
   * Returns allowed: true for self-hosted mode.
   */
  static async checkStorageLimit(userId: string): Promise<StorageLimitResult> {
    if (creditsDisabled()) {
      return { allowed: true, usedBytes: 0, limitBytes: Number.MAX_SAFE_INTEGER }
    }

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("tier, storage_used_bytes, storage_limit_bytes")
      .eq("id", userId)
      .single()

    if (error || !profile) {
      return { allowed: false, error: "User profile not found", usedBytes: 0, limitBytes: 0 }
    }

    return CreditsService.checkStorageLimitWithProfile(profile as StorageProfile)
  }

  /**
   * Check storage limit using a pre-fetched profile (avoids extra DB query).
   * The profile must include: storage_used_bytes, storage_limit_bytes.
   */
  static checkStorageLimitWithProfile(profile: StorageProfile): StorageLimitResult {
    if (creditsDisabled()) {
      return { allowed: true, usedBytes: 0, limitBytes: Number.MAX_SAFE_INTEGER }
    }

    const usedBytes = profile.storage_used_bytes ?? 0
    const tier = (profile.tier as string) ?? "free"
    const dbLimit = profile.storage_limit_bytes ?? 0
    const tierLimit = TIER_STORAGE_LIMITS[tier] ?? TIER_STORAGE_LIMITS.free
    // Use tier-based limit when DB has no value or the stale 500MB default (524288000)
    const limitBytes = dbLimit > 0 && dbLimit !== 524288000 ? dbLimit : tierLimit

    if (usedBytes >= limitBytes) {
      const usedGB = (usedBytes / (1024 * 1024 * 1024)).toFixed(1)
      const limitGB = (limitBytes / (1024 * 1024 * 1024)).toFixed(1)
      return {
        allowed: false,
        error: `Storage limit reached (${usedGB} GB of ${limitGB} GB used). Delete files or upgrade your plan.`,
        usedBytes,
        limitBytes,
      }
    }

    return { allowed: true, usedBytes, limitBytes }
  }

  /**
   * Get user's current balance and tier info
   */
  static async getBalance(userId: string): Promise<UserBalance> {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select(`
        subscription_credits,
        topup_credits,
        tier,
        subscription_tier,
        daily_spent_credits,
        last_daily_reset,
        current_period_end,
        app_credits_allowance
      `)
      .eq("id", userId)
      .single()

    if (error || !profile) {
      // Return default values if profile not found
      return {
        total: 0,
        subscription: 0,
        topup: 0,
        dailySpent: 0,
        dailyLimit: null,
        monthlyAllocation: 0,
        tier: "free",
        features: {},
        periodEnd: null,
        appCreditsAllowance: 0,
      }
    }

    const userTier = resolveTier(profile as Record<string, unknown>)

    // Get tier configuration (cached)
    const tierConfig = await getTierConfig(userTier)

    const subscriptionCredits = profile.subscription_credits ?? 0
    const topupCredits = profile.topup_credits ?? 0

    // For free tier, use FREE_TIER_RESTRICTIONS.dailyCreditCap
    const dailyLimit = userTier === "free"
      ? FREE_TIER_RESTRICTIONS.dailyCreditCap
      : (tierConfig.daily_credit_limit ?? null)

    // Reset daily spent if it's a new UTC day (otherwise stale value shows in UI)
    const dailySpent = await getEffectiveDailySpent(
      userId,
      profile.daily_spent_credits ?? 0,
      profile.last_daily_reset as string | null
    )

    // Read current_period_end: DB first, then Stripe API as self-healing fallback
    let periodEnd: string | null = profile.current_period_end ?? null
    if (userTier !== "free") {
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("current_period_end, stripe_subscription_id")
        .eq("user_id", userId)
        .eq("status", "active")
        .order("current_period_end", { ascending: false })
        .limit(1)
        .single()
      if (sub?.current_period_end) {
        periodEnd = sub.current_period_end
      }

      // Self-heal: if period end is stale (past), fetch directly from Stripe
      const isPast = !periodEnd || new Date(periodEnd).getTime() < Date.now()
      if (isPast && hasCredits()) {
        try {
          const { data: custRow } = await supabase
            .from("stripe_customers")
            .select("stripe_customer_id")
            .eq("user_id", userId)
            .single()
          if (custRow?.stripe_customer_id) {
            const { getStripe } = await import("./stripe-client.js")
            const subs = await getStripe().subscriptions.list({
              customer: custRow.stripe_customer_id,
              status: "active",
              limit: 1,
            })
            const activeSub = subs.data[0]
            if (activeSub) {
              const item = activeSub.items.data[0]
              const freshEnd = item
                ? new Date(item.current_period_end * 1000).toISOString()
                : null
              if (freshEnd) {
                periodEnd = freshEnd
                // Self-heal: update DB so we don't hit Stripe again
                const freshStart = item
                  ? new Date(item.current_period_start * 1000).toISOString()
                  : null
                await supabase
                  .from("subscriptions")
                  .upsert({
                    user_id: userId,
                    stripe_subscription_id: activeSub.id,
                    stripe_price_id: activeSub.items.data[0]?.price?.id ?? "",
                    tier: userTier,
                    status: "active",
                    current_period_start: freshStart,
                    current_period_end: freshEnd,
                  }, { onConflict: "stripe_subscription_id" })
                await supabase
                  .from("profiles")
                  .update({ current_period_end: freshEnd })
                  .eq("id", userId)
              }
            }
          }
        } catch (err) {
          // Non-critical: log and continue with stale/null periodEnd
          console.warn("[credits] Stripe subscription self-heal failed:", err)
        }
      }
    }

    return {
      total: subscriptionCredits + topupCredits,
      subscription: subscriptionCredits,
      topup: topupCredits,
      dailySpent,
      dailyLimit,
      monthlyAllocation: tierConfig.monthly_credits ?? 0,
      tier: userTier,
      features: (tierConfig.features as Record<string, unknown>) ?? {},
      periodEnd,
      appCreditsAllowance: profile.app_credits_allowance ?? 0,
    }
  }

  /**
   * Quick eligibility check for app runs (free-tier users only).
   * Returns null if eligible, or an error object if blocked.
   * Paid/topped-up users always pass.
   */
  static async checkAppRunEligibility(userId: string): Promise<{
    allowed: boolean
    error?: string
    appCreditsAllowance?: number
  }> {
    if (creditsDisabled()) return { allowed: true }

    const { data: profile } = await supabase
      .from("profiles")
      .select("tier, subscription_tier, topup_credits, app_credits_allowance")
      .eq("id", userId)
      .single()

    if (!profile) return { allowed: true } // fail open — per-node check will catch

    const userTier = resolveTier(profile as Record<string, unknown>)
    if (userTier !== "free") return { allowed: true }

    const topup = (profile.topup_credits as number) ?? 0
    if (topup > 0) return { allowed: true }

    const allowance = (profile.app_credits_allowance as number) ?? 0
    if (allowance <= 0) {
      return {
        allowed: false,
        error: "You need app credits to run this app. Earn them by running flows in the editor, or upgrade your plan.",
        appCreditsAllowance: allowance,
      }
    }

    return { allowed: true, appCreditsAllowance: allowance }
  }

  /**
   * Get credit cost for a specific model
   */
  static async getModelCreditCost(modelIdentifier: string): Promise<number> {
    const pricing = await getModelCreditCostFromDB(modelIdentifier)
    return pricing.creditCost
  }

  /**
   * Estimate credits for a workflow, reading node data for variable-cost nodes.
   * Mirrors the frontend getModelIdentifier() logic for composite model identifiers.
   */
  static estimateWorkflowCredits(nodes: ReadonlyArray<{ type: string; data?: Record<string, unknown> }>): number {
    return nodes.reduce((sum, node) => {
      const modelId = getNodeModelIdentifier(node)
      return sum + (STATIC_CREDIT_COSTS[modelId] ?? STATIC_CREDIT_COSTS[node.type] ?? 0)
    }, 0)
  }
}

/**
 * Compute composite model identifier from a workflow node for credit estimation.
 * Mirrors frontend getModelIdentifier() in config-panels/helpers.ts.
 */
function getNodeModelIdentifier(node: { type: string; data?: Record<string, unknown> }): string {
  const nodeType = node.type
  const data = node.data ?? {}

  // AI Writer always uses "ai-writer"
  if (nodeType === "ai-writer") return "ai-writer"

  // LLM Chat uses tiered credit identifier based on selected model
  if (nodeType === "llm-chat") {
    const llmModel = data.llmModel as string | undefined
    return buildLlmCreditIdentifier("llm-chat", llmModel)
  }

  // Suno generate/cover/extend use "model" field (V4/V5/V5_5)
  if (nodeType.startsWith("suno-") && nodeType !== "suno-lyrics" && nodeType !== "suno-separate" && nodeType !== "suno-music-video") {
    const m = data.model as string
    if (m === "V5_5") return "suno-v5_5"
    if (m === "V5") return "suno-v5"
    return nodeType
  }

  // Suno separate: "split_stem" costs more
  if (nodeType === "suno-separate") {
    return (data.type as string) === "split_stem" ? "suno-separate-stem" : "suno-separate"
  }

  // Audio separation (Demucs): "best" quality costs more
  if (nodeType === "audio-separation") {
    return (data.quality as string) === "best" ? "audio-separation:best" : "audio-separation"
  }

  // Video Analysis: duration-bucketed pricing. Mirror payload-builder's
  // `case "video-analysis"` (single source of truth = buildVideoAnalysisCreditId),
  // minus the graph-only resolvedInputs.videoDuration this pre-execution estimate
  // can't see: bucket from data.probedYoutube ONLY when URL-bound to the effective
  // youtubeUrl; else the <model>:600s ceiling. videoUrl wins over youtubeUrl.
  if (nodeType === "video-analysis") {
    const videoUrl = data.videoUrl as string | undefined
    const youtubeUrl = videoUrl ? undefined : (data.youtubeUrl as string | undefined)
    const probed = data.probedYoutube as { url: string; durationSec: number } | undefined
    const durationSec =
      youtubeUrl && probed && probed.url === youtubeUrl ? probed.durationSec : undefined
    return buildVideoAnalysisCreditId(
      (data.llmModel as string | undefined) ?? "gemini-3-flash",
      durationSec,
    )
  }

  const provider = data.provider as string | undefined
  if (!provider) return nodeType

  // Extend-video: VEO quality costs more than fast
  if (nodeType === "extend-video" && provider === "veo-extend" && data.model === "quality") {
    return "veo-extend:quality"
  }

  // Extend-video: seedance trim-stitch extend prices by duration tier ×
  // resolution (rows already include the ffmpeg stitch overhead).
  if (nodeType === "extend-video" && provider === "seedance-2-extend") {
    return buildVideoCreditModelIdentifier(
      provider,
      (data.duration as number) ?? 8,
      undefined,
      undefined,
      undefined,
      (data.resolution as string) ?? "720p",
    )
  }

  // Motion transfer: duration-tiered pricing
  if (nodeType === "motion-transfer") {
    return buildMotionCreditModelIdentifier(
      provider,
      (data.resolution as string) ?? "720p",
      data.videoDuration as number | undefined,
    )
  }

  // Video nodes with duration/audio-based variable pricing
  if (nodeType === "image-to-video" || nodeType === "text-to-video") {
    const duration = data.duration as number | string | undefined
    const sound = (data.sound ?? data.kling3Sound) as boolean | undefined
    return buildVideoCreditModelIdentifier(provider, duration, sound, nodeType as "image-to-video" | "text-to-video", (data.videoSize ?? data.mode) as string | undefined)
  }

  // Unified generate-video node — mode dispatch (i2v vs t2v) happens at
  // execution time based on the wiring shape, which the pre-execution
  // estimate doesn't see. Default to the i2v identifier so display estimates
  // reflect the more common path; the runtime reservation in payload-builder
  // computes the correct identifier from the resolved inputs.
  if (nodeType === "generate-video") {
    const duration = data.duration as number | string | undefined
    const sound = (data.sound ?? data.kling3Sound) as boolean | undefined
    return buildVideoCreditModelIdentifier(provider, duration, sound, "image-to-video", (data.videoSize ?? data.mode ?? data.kling3Mode) as string | undefined)
  }

  // Image/edit nodes with quality/resolution variable pricing
  return buildCreditModelIdentifier(
    provider,
    data.quality as string | undefined,
    data.resolution as string | undefined,
    data.renderingSpeed as string | undefined,
    data.targetResolution as string | undefined,
  )
}

// Export legacy function for backward compatibility
export function estimateWorkflowCredits(nodes: ReadonlyArray<{ type: string; data?: Record<string, unknown> }>): number {
  return CreditsService.estimateWorkflowCredits(nodes)
}
