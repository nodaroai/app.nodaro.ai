import { supabase } from "../../lib/supabase.js"
import { hasCredits } from "../../lib/config.js"
import { getAppSettings } from "../../lib/app-settings.js"
import { FREE_TIER_RESTRICTIONS, TIER_STORAGE_LIMITS } from "./stripe-config.js"
import { buildCreditModelIdentifier, buildVideoCreditModelIdentifier, buildMotionCreditModelIdentifier } from "@nodaro/shared"
import { buildLlmCreditIdentifier } from "@nodaro/shared"
import { flux2BaseCredits, FLUX2_RES_MP, type Flux2Model } from "@nodaro/shared"
import {
  AI_AVATAR_DURATION_BUCKETS,
  AI_AVATAR_RATE_USD_PER_SEC,
  aiAvatarHoldCredits,
  resolveAiAvatarCreditId,
  type AiAvatarEngine,
  type AiAvatarResolution,
} from "@nodaro/shared"
import {
  CINEMATIC_RATE_USD_PER_SEC,
  CINEMATIC_MIN_DURATION_SEC,
  CINEMATIC_MAX_DURATION_SEC,
  cinematicCreditId,
  cinematicHoldCredits,
  resolveCinematicCreditId,
  type CinematicResolution,
} from "@nodaro/shared"

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
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
// at RESERVE time, and the reserve buckets UP (true clip ≤ bucket ceiling), so
// reserved ≥ metered-actual already (they're EQUAL at the bucket ceiling, where
***REDACTED-OSS-SCRUB***
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
***REDACTED-OSS-SCRUB***
// the admin markup is applied to this stored value at RESERVE time, so the
// reserved tier equals the metered actual (same exact duration, same base).
// A missing id causes a hard 503 `price_not_configured` at runtime.
const CINEMATIC_STATIC: Record<string, number> = {}
for (const resolution of Object.keys(CINEMATIC_RATE_USD_PER_SEC) as CinematicResolution[]) {
  for (let d = CINEMATIC_MIN_DURATION_SEC; d <= CINEMATIC_MAX_DURATION_SEC; d++) {
    CINEMATIC_STATIC[cinematicCreditId(resolution, d)] = cinematicHoldCredits(resolution, d)
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
  ***REDACTED-OSS-SCRUB***
  // Markup % is configurable in admin settings (app_settings.cost_markup_percent).
  // Base entries = default/cheapest setting. Composite entries = specific setting.
  //
  // ── Image Generation ──
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "reference-sheet:assembly": 4, // Flat sheet-assembly fee; per-panel gen priced separately (bare provider key)
  "reference-sheet:assembly-motion": 6, // Flat FFmpeg-assembly fee for motion sheets; motion clips priced separately by the motion routes
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "seedream-5-lite:high": 5,     // estimated (4K)
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // ── Replicate "Open" (uncensored) — run direct via Replicate, not KIE ──
  // Base rows (representative default-resolution 0-ref) — for admin display and
  // single-node runs where no :MP:ref composite is available yet.
  // Per-MP×ref composites are spread below via FLUX2_STATIC.
  "flux-2-klein": 1,             // default 1MP 0ref — BFL Flux 2 9B Klein via Replicate
  ***REDACTED-OSS-SCRUB***
  "flux-2-pro": 3,               // default 2MP 0ref — BFL Flux 2 Pro via Replicate, safety_tolerance=5
  "flux-2-max": 7,               // default 2MP 0ref — BFL Flux 2 Max via Replicate, safety_tolerance=5
  // Full per-MP×ref grid for Flux 2 family (108 entries, see flux2BaseCredits formula).
  // Identifier format: `<model>:<mp>MP:<n>ref` (mp ∈ {0.5,1,2,4}, n ∈ 0..8).
  ...FLUX2_STATIC,
  // AI Avatar (HeyGen) — 42 duration-bucketed reserve holds (2 engines × 3 resolutions × 7 buckets (30/60/120/240/360/600/900s)).
  // Format: `heygen-<engine>:<resolution>:<bucketSec>s`  e.g. `heygen-avatar-iv:720p:60s`.
  ***REDACTED-OSS-SCRUB***
  ...AI_AVATAR_STATIC,
  // Cinematic Avatar (HeyGen) — 24 exact-duration reserve holds (2 resolutions × 12 durations 4..15s).
  // Format: `cinematic-avatar:<resolution>:<durationSec>s`  e.g. `cinematic-avatar:720p:10s`.
  ***REDACTED-OSS-SCRUB***
  // Rate is an UNCONFIRMED estimate — confirm via a paid run per audit-credits ship-gate.
  ...CINEMATIC_STATIC,
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // ── Image Editing ──
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // ── Image-to-Image ──
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "seedream-5-lite-i2i:high": 5, // estimated (4K)
  // ── Video Generation (I2V / T2V) ──
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // Kling 2.6 duration-tiered pricing (5s/10s, audio doubles cost)
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // Kling Turbo duration-tiered pricing
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // Kling 3.0 duration-tiered pricing (1080P, per-second: 27 no audio, 40 with audio)
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // Grok I2V duration-tiered pricing (shared with grok T2V)
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // ── Grok Imagine Video 1.5 (KIE) — per-second billing, 480p/720p, image-to-video. ──
  // KIE 14.5 cr/s @480p, 25 cr/s @720p, +2 cr/image (always 1 image → +2 in every tier).
  // Nodaro = ceil(KIE_total / 4) — priced at cost, like Seedance-2. Base = 8s/480p.
  "grok-imagine-video-1.5": 30,
  // 480p (KIE 14.5 cr/s + 2)
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // 720p (KIE 25 cr/s + 2)
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // ── Seedance 2.0 — per-second billing, resolution × video-ref dimensions ──
  // Base fallback (8s/480p/no-ref)
  "seedance-2": 38,
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // 1080p no video ref (61.5 KIE cr/s — extrapolated 1.5× of 720p rate;
  // KIE pricing page isn't fetchable from the dev env, and the 1.5×
  // 720p→1080p factor matches the established convention used by
  // Kling 2.6 (6→9 cr/s) and Kling 3.0 (12→20 cr/s) families.)
  "seedance-2:4s:1080p": 62,     // 246 KIE cr, $1.23
  "seedance-2:8s:1080p": 123,    // 492 KIE cr, $2.46
  "seedance-2:12s:1080p": 185,   // 738 KIE cr, $3.69
  "seedance-2:15s:1080p": 231,   // 922.5 KIE cr, $4.6125
  // 1080p with video ref (37.5 KIE cr/s — 1.5× of 720p ref rate)
  "seedance-2:4s:1080p-ref": 38, // 150 KIE cr, $0.75
  "seedance-2:8s:1080p-ref": 75, // 300 KIE cr, $1.50
  "seedance-2:12s:1080p-ref": 113, // 450 KIE cr, $2.25
  "seedance-2:15s:1080p-ref": 141, // 562.5 KIE cr, $2.8125
  // ── Seedance 2.0 Fast — same matrix, lower rates ──
  "seedance-2-fast": 31,
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // 480p with video ref (8 KIE cr/s)
  "seedance-2-fast:4s:480p-ref": 8,    // 32 KIE cr, $0.16
  "seedance-2-fast:8s:480p-ref": 16,   // 64 KIE cr, $0.32
  "seedance-2-fast:12s:480p-ref": 24,  // 96 KIE cr, $0.48
  "seedance-2-fast:15s:480p-ref": 30,  // 120 KIE cr, $0.60
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // 1080p no video ref (49.5 KIE cr/s — 1.5× of 720p rate)
  "seedance-2-fast:4s:1080p": 50,      // 198 KIE cr, $0.99
  "seedance-2-fast:8s:1080p": 99,      // 396 KIE cr, $1.98
  "seedance-2-fast:12s:1080p": 149,    // 594 KIE cr, $2.97
  "seedance-2-fast:15s:1080p": 186,    // 742.5 KIE cr, $3.7125
  // 1080p with video ref (30 KIE cr/s — 1.5× of 720p ref rate)
  "seedance-2-fast:4s:1080p-ref": 30,  // 120 KIE cr, $0.60
  "seedance-2-fast:8s:1080p-ref": 60,  // 240 KIE cr, $1.20
  "seedance-2-fast:12s:1080p-ref": 90, // 360 KIE cr, $1.80
  "seedance-2-fast:15s:1080p-ref": 113, // 450 KIE cr, $2.25
  ***REDACTED-OSS-SCRUB***
  "gemini-omni-video": 23,         // base = 720p/1080p 4s
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // Wan I2V duration-tiered pricing (720p default)
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // Hailuo 2.3 Pro duration-tiered pricing (768p default)
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // Hailuo 2.3 duration-tiered pricing
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // Hailuo Standard duration-tiered pricing
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // Kling Master duration-tiered pricing
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // Kling 3 Omni duration-tiered pricing (Replicate, estimated — actual cost tracked via predict_time)
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // ── Lightricks LTX 2.3 (Replicate) — official pricing from replicate.com/lightricks/ltx-2.3-{pro,fast} ──
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "ltx-2.3-pro": 24,             // default = 1080p:6s
  ***REDACTED-OSS-SCRUB***
  "ltx-2.3-pro:1080p:8s": 32,
  "ltx-2.3-pro:1080p:10s": 40,
  ***REDACTED-OSS-SCRUB***
  "ltx-2.3-pro:2k:8s": 64,
  "ltx-2.3-pro:2k:10s": 80,
  ***REDACTED-OSS-SCRUB***
  "ltx-2.3-pro:4k:8s": 128,
  "ltx-2.3-pro:4k:10s": 160,
  // Fast: text/image→video, 1080p/2k/4k, durations 6–20s (1080p only past 10s). Base = 1080p:6s.
  "ltx-2.3-fast": 18,            // default = 1080p:6s
  ***REDACTED-OSS-SCRUB***
  "ltx-2.3-fast:1080p:8s": 24,
  "ltx-2.3-fast:1080p:10s": 30,
  "ltx-2.3-fast:1080p:12s": 36,
  "ltx-2.3-fast:1080p:14s": 42,
  "ltx-2.3-fast:1080p:16s": 48,
  "ltx-2.3-fast:1080p:18s": 54,
  "ltx-2.3-fast:1080p:20s": 60,
  ***REDACTED-OSS-SCRUB***
  "ltx-2.3-fast:2k:8s": 48,
  "ltx-2.3-fast:2k:10s": 60,
  ***REDACTED-OSS-SCRUB***
  "ltx-2.3-fast:4k:8s": 96,
  "ltx-2.3-fast:4k:10s": 120,
  // LTX extend + retake (Pro only, 1080p): per-second × duration at credit-guard time.
  // 5 cr/sec matches Pro:1080p rate (extend output is at the input's resolution; retake is locked 1080p).
  "ltx-2.3-pro-extend:per-second": 4,
  "ltx-2.3-pro-retake:per-second": 4,
  ***REDACTED-OSS-SCRUB***
  // ── Video Extend ──
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // ── VEO Upscale ──
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // ── Video-to-Video / Motion ──
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // Wan 2.7 T2I — 1K/2K/4K (estimated, adjust after audit-credits post-ship)
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***

  // Wan 2.7 Pro T2I — 1K/2K/4K (estimated)
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***

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
  ***REDACTED-OSS-SCRUB***

  // Wan 2.7 T2V (estimated)
  ***REDACTED-OSS-SCRUB***

  // HappyHorse (estimated)
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // ── Motion Transfer (per-second pricing, duration-tiered) ──
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "kling-motion": 15,            // alias
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // Wan Animate (Move + Replace) — resolution-tiered pricing
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
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
  // HeyGen Lipsync Precision + Sync Lipsync 2 Pro (Replicate, video-input dubbing).
  // Billed per second of output; bucketed like kling-avatar via buildLipSyncCreditId.
  ***REDACTED-OSS-SCRUB***
  // sets no meteredCost, so the worker commits the reserved bucket as the charge.
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // ── Replicate MMAudio (video-sfx node) ──
  // BASE credits (pre-markup). creditGuard applies cost_markup_percent at request time.
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "replicate-mmaudio":       1,  // base/legacy default (8s bucket)
  "replicate-mmaudio:8s":    1,
  "replicate-mmaudio:15s":   1,
  "replicate-mmaudio:30s":   2,
  "replicate-mmaudio:60s":   3,
  "replicate-mmaudio:120s":  5,
  "replicate-mmaudio:300s": 11,
  ***REDACTED-OSS-SCRUB***
  // ── Audio / TTS / Music ──
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "elevenlabs": 2,               // alias for turbo
  ***REDACTED-OSS-SCRUB***
  // Replicate disabled
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "suno-separate": 4,            // matches model_pricing (mig 059); held by re-baseline (unclear)
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "suno-voice-create": 20,       // One-time persona creation (validate + generate); KIE does not publish pricing — flat conservative default
  // Replicate disabled
  // "musicgen": 7,                 // Replicate Meta MusicGen
  // "lyria": 7,                    // Replicate Google Lyria 2
  // "bark": 7,                     // Replicate Suno Bark
  ***REDACTED-OSS-SCRUB***
  // Replicate disabled
  // "whisper": 4,                   // Replicate whisper transcription
  // "incredibly-fast-whisper": 4,   // Replicate fast whisper
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "voice-clone": 5,              // ElevenLabs instant voice clone
  "elevenlabs-voice-changer": 4,  // ElevenLabs speech-to-speech
  "elevenlabs-dubbing": 8,        // ElevenLabs dubbing (async)
  "elevenlabs-voice-remix": 4,    // ElevenLabs voice remix/preview
  "elevenlabs-voice-design": 5,   // ElevenLabs voice design (full controls)
  "elevenlabs-forced-alignment": 3, // ElevenLabs forced alignment
  "infinitalk": 42,              // fallback (720p default)
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // ── Speech-to-Video ──
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  // ── Processing ──
  "topaz": 1,                     // processing
  "ffmpeg": 1,
  "render-video": 5,            // Remotion compute
  // Replicate disabled
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
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
  ***REDACTED-OSS-SCRUB***
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
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  "combine-videos": 3,
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
  "image-critic": 1,
  "image-critic:economy": 1,
  "image-critic:premium": 2,
  "character": 2,
  "object": 2,
  "location": 2,
  "voice-changer": 4,
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
  ***REDACTED-OSS-SCRUB***
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

    return CreditsService.checkCreditsWithProfile(userId, profile as CreditProfile, modelIdentifier, isAppRun)
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

  const provider = data.provider as string | undefined
  if (!provider) return nodeType

  // Extend-video: VEO quality costs more than fast
  if (nodeType === "extend-video" && provider === "veo-extend" && data.model === "quality") {
    return "veo-extend:quality"
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
