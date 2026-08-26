import { supabase } from "../../lib/supabase.js"
import { ReserveRpcError, reservePrefixOf } from "../../lib/reserve-errors.js"
import { attemptAutoRecharge } from "./auto-recharge.js"
import { hasCredits } from "../../lib/config.js"
import { getAppSettings } from "../../lib/app-settings.js"
import { FREE_TIER_RESTRICTIONS, TIER_STORAGE_LIMITS } from "./stripe-config.js"
import { PIPELINE_PINNABLE_SCRIPT_LLMS, getLlmTier, buildCreditModelIdentifier, buildVideoCreditModelIdentifier, buildMotionCreditModelIdentifier, buildLlmCreditIdentifier, FLUX2_RES_MP, type Flux2Model, AI_AVATAR_DURATION_BUCKETS, resolveAiAvatarCreditId, type AiAvatarEngine, type AiAvatarResolution, CINEMATIC_MIN_DURATION_SEC, CINEMATIC_MAX_DURATION_SEC, cinematicCreditId, resolveCinematicCreditId, type CinematicResolution, resolveSwitchXCreditId, VIDEO_ANALYSIS_DURATION_BUCKETS, VIDEO_ANALYSIS_MAX_DURATION_SEC, VIDEO_ANALYSIS_BUCKET_CREDITS, buildVideoAnalysisCreditId, resolveVideoAnalysisModel, DEFAULT_VIDEO_ANALYSIS_MODEL, VIDEO_AUDIT_BUCKET_CREDITS, buildVideoAuditCreditId, resolveEffectiveTier, resolveStoredTier } from "@nodaro/shared"
// Provider-$ cost formulas — CORE lib (not @nodaro/shared, an irrevocably
// published Apache package). See the 2026-07-06 public-flip IP audit, S5.
import { flux2BaseCredits } from "../../lib/pricing/flux2-cost.js"
import { AI_AVATAR_RATE_USD_PER_SEC, aiAvatarHoldCredits } from "../../lib/pricing/ai-avatar-cost.js"
import { effectiveMarkupPercent } from "./service-margin.js"
import { CINEMATIC_RATE_USD_PER_SEC, cinematicHoldCredits } from "../../lib/pricing/cinematic-avatar-cost.js"

// ── Flux 2 per-MP×ref static costs (generated from flux2BaseCredits formula) ──
// Identifier format: `<model>:<mp>MP:<n>ref` (e.g. `flux-2-max:2MP:1ref`)
// These are base credits (markup is applied once at lookup via getAppSettings).
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
// The stored value is the base credit amount; the admin-configured markup applies at read time.
// getModelCreditCostFromDB applies the admin markup (configurable) to this stored value
// at RESERVE time, and the reserve buckets UP (true clip ≤ bucket ceiling), so
// reserved ≥ metered-actual already (they're EQUAL at the bucket ceiling, where
// both derive from the same base). The old padded hold double-buffered
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
// no bucketing. The stored value is the base credit amount;
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
// The credit numbers ARE the precomputed VIDEO_ANALYSIS_BUCKET_CREDITS table in
// @nodaro/shared (the public prices). The $-derived formula + measured-rate
// constants that GENERATE them are private, in @nodaroai/cloud-plugins
// (in the plugin repo), with a CI cross-check against this same
// shared table so the numbers can't silently drift.
// Per model: a bare id `video-analysis:<model>` (= the 600s unknown-duration
// ceiling) + one composite per bucket `video-analysis:<model>:<bucket>s`.
// The two models mirror the catalog's video-analysis entries (model-catalog.ts)
// and the model_pricing rows (migrations 247+248) — extend all of them together
// if a third video+audio model ships.
//
// Current values are deliberately NOT listed here — this comment hand-copied
// them once and then sat stale through five repricings (last caught 2026-08-03,
// task A3: the block still quoted pre-6fps-rebase, pre-redenomination numbers
// and never mentioned `smart` at all). Read the live numbers from
// VIDEO_ANALYSIS_BUCKET_CREDITS in `@nodaro/shared` (video-analysis-pricing.ts),
// `/admin/models`, or `GET /v1/credits/model-cost`.
// `mixed` is the shared credit family for BOTH mixed analysis tiers
// (`mixed` + `mixed-fast` — variants of one engine plan; internals live in
// the private analysis plugin); videoAnalysisCreditSegment maps the sentinels.
// ── Pipeline-pinnable script LLMs — BARE model ids, not feature composites ──
// `create-pipeline.ts`'s tier guard calls `checkCreditsWithProfile` with the
// bare pinned id (alongside pinned image/video model ids, which ARE priced), so
// it lands in `getModelCreditBaseCost` — and the 2026-05 hard-fail policy throws
// `PriceNotConfiguredError` on any unconfigured identifier. An unpriced pinnable
// id therefore turns "pick this Script LLM" into a 500 instead of a pipeline.
// Derived from the shared allowlist × each model's registry tier so ADDING a
// pinnable model cannot reintroduce the gap (guarded by hard-fail-coverage.test).
// Gate-only: the pin check never deducts — the stage's real charge rides the
// generate-script / llm-chat feature identifiers and their tier composites.
const PINNABLE_SCRIPT_LLM_STATIC: Record<string, number> = Object.fromEntries(
  PIPELINE_PINNABLE_SCRIPT_LLMS.map((id) => {
    const tier = getLlmTier(id) // dash-form ids resolve via the registry's alias fallback
    // Gate-only sentinel values at the current credit base (never deducted —
    // the stage's real charge rides the feature identifiers). Scaled x10 with
    // the re-denomination so they stay consistent with model_pricing; the
    // parity check compares them.
    return [id, tier === "economy" ? 10 : tier === "premium" ? 30 : 20]
  }),
)

const VIDEO_ANALYSIS_STATIC: Record<string, number> = {}
// Model-backed tiers plus the two engine-plan SENTINELS that own credit rows
// (`mixed` and `smart`). `mixed-fast` is absent because it shares `mixed`'s credit
// family, so its colon ids are never built.
for (const model of ["gemini-3-flash", "gemini-3.6-flash", "gemini-3.1-pro", "mixed", "smart"]) {
  // Bare per-model id (`video-analysis:<model>`) = the unknown-duration ceiling
  // (600s). buildVideoAnalysisCreditId NEVER produces this id — it always appends
  // a `:<bucket>s` suffix; the bare id exists in STATIC only because MODEL_CATALOG
  // lists `video-analysis:<model>` as each model's base pricing row.
  VIDEO_ANALYSIS_STATIC[`video-analysis:${model}`] =
    VIDEO_ANALYSIS_BUCKET_CREDITS[buildVideoAnalysisCreditId(model, VIDEO_ANALYSIS_MAX_DURATION_SEC)]!
  for (const bucketSec of VIDEO_ANALYSIS_DURATION_BUCKETS) {
    VIDEO_ANALYSIS_STATIC[`video-analysis:${model}:${bucketSec}s`] =
      VIDEO_ANALYSIS_BUCKET_CREDITS[buildVideoAnalysisCreditId(model, bucketSec)]!
  }
}

// ── Video Audit ("AI Audit", video-audit node) duration-bucketed reserve
// holds — sibling of VIDEO_ANALYSIS_STATIC above, same generator-authoritative
// table (VIDEO_AUDIT_BUCKET_CREDITS in @nodaro/shared), same bucket ladder.
// Two FAMILIES instead of per-model: `video-audit` (an analysis was already
// wired in — re-audits it) and `video-audit:auto` (no analysis wired — the
// node auto-runs a fast analysis first). Unlike video-analysis's per-model
// bare ids (always `video-analysis:<model>`, never colliding with the bare
// node-type string), the base family's bare form IS the literal node type
// (`video-audit`, no suffix) — by design (see video-analysis-pricing.ts):
// `estimateWorkflowCredits`'s STATIC_CREDIT_COSTS[node.type] fallback for a
// video-audit node with no more specific composite therefore resolves to
// this same value, matching the DB row migration 302 seeds for the bare
// `video-audit` identifier (no separate cross-family max is minted here).
const VIDEO_AUDIT_STATIC: Record<string, number> = {}
for (const analysisProvided of [true, false]) {
  const family = analysisProvided ? "video-audit" : "video-audit:auto"
  // Bare per-family id = the unknown-duration ceiling (600s). buildVideoAuditCreditId
  // NEVER produces this id on its own — it always appends a `:<bucket>s` suffix; the
  // bare id exists in STATIC only because MODEL_CATALOG lists it as the family's base
  // pricing row (mirrors VIDEO_ANALYSIS_STATIC's per-model bare-id rationale above).
  VIDEO_AUDIT_STATIC[family] =
    VIDEO_AUDIT_BUCKET_CREDITS[buildVideoAuditCreditId({ analysisProvided, durationSec: VIDEO_ANALYSIS_MAX_DURATION_SEC })]!
  for (const bucketSec of VIDEO_ANALYSIS_DURATION_BUCKETS) {
    VIDEO_AUDIT_STATIC[`${family}:${bucketSec}s`] =
      VIDEO_AUDIT_BUCKET_CREDITS[buildVideoAuditCreditId({ analysisProvided, durationSec: bucketSec })]!
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
  /** Pool-aware web block (D1 v2): the free pool can't cover a payg web run —
   *  the guard answers with the subscription_required modal, not a 402. */
  subscriptionRequired?: boolean
}

export interface UserBalance {
  total: number
  subscription: number
  topup: number
  dailySpent: number
  dailyLimit: number | null
  monthlyAllocation: number
  /** Stored tier (billing identity). Kept for back-compat — display should use effectiveTier. */
  tier: string
  /** Derived tier: "payg" when stored-free with net lifetime top-ups > 0. */
  effectiveTier: string
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
  /**
   * REQUIRED (not optional): the payg derivation needs it, and a producer
   * whose SELECT forgot the column must fail to compile — `?? 0` here would
   * silently deactivate payg (the exact regression the shared helper's
   * required-field shape exists to prevent).
   */
  lifetime_topup_credits: number
  subscription_credits?: number | null
  topup_credits?: number | null
  daily_spent_credits?: number | null
  last_daily_reset?: string | null
  app_credits_allowance?: number | null
}

/**
 * Pre-fetched profile shape for checkStorageLimitWithProfile.
 * Must include storage columns + the tier trio for the effective-tier
 * fallback (see CreditProfile.lifetime_topup_credits on why it's required).
 */
export interface StorageProfile {
  tier?: string | null
  subscription_tier?: string | null
  lifetime_topup_credits: number
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
  "nano-banana": 10,
  "nano-banana-2": 20,             // (1K default)
  "nano-banana-2:2K": 50,
  "nano-banana-2:4K": 50,
  "nano-banana-2-lite": 10,        // 1K only, flat
  "nano-banana-pro": 45,          // (1K/2K default)
  "nano-banana-pro:4K": 60,
  "flux": 13,                     // (1K default)
  "flux:2K": 20,
  "grok": 10,
  "grok-2": 10,                   // Grok Imagine Image 2.0 t2i ($0.02)
  "gpt-image": 10,                // (medium default)
  "gpt-image:high": 60,
  "gpt-image-2": 15,              // (1K default; estimated, recalibrate from anomalies)
  "gpt-image-2:2K": 30,           // (estimated)
  "gpt-image-2:4K": 60,           // (estimated)
  "reference-sheet:assembly": 40, // Flat sheet-assembly fee; per-panel gen priced separately (bare provider key)
  "reference-sheet:assembly-motion": 60, // Flat FFmpeg-assembly fee for motion sheets; motion clips priced separately by the motion routes
  "imagen4": 20,
  "imagen4-fast": 10,
  "imagen4-ultra": 30,
  "qwen": 10,
  "seedream": 16,
  "seedream:high": 40,            // estimated (4K)
  "seedream-5-lite": 14,
  "seedream-5-lite:high": 50,     // estimated (4K)
  "seedream-5-pro": 18,           // (basic / 1K default)
  "seedream-5-pro:high": 60,      // high / 2K
  "flux-flex": 35,                // (1K default)
  "flux-flex:2K": 60,
  "z-image": 2,
  "flux-kontext": 13,
  "flux-kontext-max": 25,
  // ── Replicate "Open" (uncensored) — run direct via Replicate, not KIE ──
  // Base rows (representative default-resolution 0-ref) — for admin display and
  // single-node runs where no :MP:ref composite is available yet.
  // Per-MP×ref composites are spread below via FLUX2_STATIC.
  // DERIVED from the same formula as the composites below, at each model's
  // default resolution — never hand-written. These were literals (1/3/7) that
  // the x10 re-denomination hand-multiplied to 10/30/70, which amplified the
  // rounding error they already carried at the old coarse credit scale: the
  // formula and migration 288's DB rows both say 3/23/70 for these exact
  // defaults. Deriving keeps the fallback honest through any future reprice.
  "flux-2-klein": flux2BaseCredits("flux-2-klein", 1, 0),  // default 1MP 0ref — BFL Flux 2 9B Klein via Replicate
  "kontext-multi": 30,            // multi-image-kontext-pro via Replicate
  "flux-fill": 30,                // FLUX Fill Pro (masked inpainting) via Replicate
  "flux-2-pro": flux2BaseCredits("flux-2-pro", 2, 0),      // default 2MP 0ref — BFL Flux 2 Pro via Replicate, safety_tolerance=5
  "flux-2-max": flux2BaseCredits("flux-2-max", 2, 0),      // default 2MP 0ref — BFL Flux 2 Max via Replicate, safety_tolerance=5
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
  // estimateWorkflowCredits; never reserved). Pinned to the DEFAULT tier
  // model's 10-min ceiling (gemini-3.1-pro @ 600s = 11). Per-model bares +
  // per-model duration composites are read from the shared table above
  // (VIDEO_ANALYSIS_STATIC); see that block for the PROVISIONAL/Gate-0.5 (18b)
  // reconciliation note.
  // The MAX of the whole table, not the default tier at the ceiling bucket: the
  // default (pro) tops out at 120 while `mixed` reaches 200, so "default model,
  // longest video" is itself an under-quote. This id is the unknown-model AND
  // unknown-duration fallback, so it has to bound every row — it feeds a pre-run
  // balance gate, and a gate that under-quotes protects nothing. Pinned by
  // `video-analysis-catalog-sync.test.ts` and written by migration 277.
  "video-analysis": Math.max(...Object.values(VIDEO_ANALYSIS_BUCKET_CREDITS)),
  ...VIDEO_ANALYSIS_STATIC,
  // ── Video Audit ("AI Audit") — duration-bucketed, two families (analysis
  // wired vs auto-run). See VIDEO_AUDIT_STATIC above; values are the
  // precomputed VIDEO_AUDIT_BUCKET_CREDITS table in @nodaro/shared, written to
  // model_pricing by migration 302.
  ...VIDEO_AUDIT_STATIC,
  "flux-lora-character": 20,      // flux-dev-lora inference via Replicate. Internal-only id selected by payload-builder when a single trained @character is mentioned.
  "character-lora-training": 1500, // Replicate ostris/flux-dev-lora-trainer (1000 steps, one-shot). Refunded by webhook on failure/cancel.
  // ── Image Editing ──
  "recraft-upscale": 2,
  "recraft-remove-bg": 3,
  "nano-banana-edit": 10,
  "topaz-image-upscale": 25,      // (2K default)
  "topaz-image-upscale:4K": 50,
  "topaz-image-upscale:8K": 100,
  "grok-upscale": 25,
  // Grok Imagine 2 task-chained ops (prior grok-2 task_id, not an image URL)
  "grok-2-edit": 10,
  "grok-2-i2i": 10, // segment(free) + edit chain — same provider cost as t2i              // prompt/region edit ($0.02)
  "grok-2-segment": 0,            // segment map is FREE upstream
  // ── Image-to-Image ──
  "flux-i2i": 60,                 // (1K default)
  "flux-i2i:2K": 60,
  "flux-pro-i2i": 13,             // (1K default)
  "flux-pro-i2i:2K": 20,
  "grok-i2i": 10,
  "gpt-image-i2i": 10,            // (medium default)
  "gpt-image-i2i:high": 60,
  "gpt-image-2-i2i": 15,          // (1K default; estimated)
  "gpt-image-2-i2i:2K": 30,       // (estimated)
  "gpt-image-2-i2i:4K": 60,       // (estimated)
  "ideogram-edit": 45,            // (BALANCED default)
  "ideogram-edit:TURBO": 30,
  "ideogram-edit:QUALITY": 60,
  "ideogram-remix": 45,           // (BALANCED default)
  "ideogram-remix:TURBO": 30,
  "ideogram-remix:QUALITY": 60,
  "ideogram-reframe": 18,         // (V3 Reframe BALANCED)
  "ideogram-reframe:TURBO": 18,
  "ideogram-reframe:QUALITY": 18,
  "ideogram-v3": 18,              // (BALANCED default)
  "ideogram-v3:TURBO": 18,
  "ideogram-v3:QUALITY": 18,
  "qwen-i2i": 10,
  "qwen-edit": 13,
  "seedream-edit": 16,
  "seedream-edit:high": 40,       // estimated (4K)
  "seedream-5-lite-i2i": 14,
  "seedream-5-lite-i2i:high": 50, // estimated (4K)
  "seedream-5-pro-i2i": 19,       // (basic / 1K default)
  "seedream-5-pro-i2i:high": 60,  // high / 2K
  // ── Video Generation (I2V / T2V) ──
  "minimax": 143,                 // (6s, 1080p)
  "veo3": 1000,                    // (VEO 3.1 Quality)
  "veo3.1": 150,                  // (VEO 3.1 Fast @ 720p)
  "veo3.1:1080p": 170,            // (VEO 3.1 Fast @ 1080p)
  "veo3_lite": 75,               // (VEO 3.1 Lite @ 720p)
  "veo3_lite:1080p": 90,         // (VEO 3.1 Lite @ 1080p)
  // Direct-4K generation (base 1080p → chained get-4k-video). Base cost, NO markup
  // (admin panel applies markup). KIE: ceil(KIE_cr/4). docs.kie.ai VEO 3.1 4K.
  "veo3:4k": 930,                 // (VEO 3.1 Quality @ 4K)
  "veo3.1:4k": 450,               // (VEO 3.1 Fast @ 4K)
  "veo3_lite:4k": 380,           // (VEO 3.1 Lite @ 4K)
  "kling": 280,                   // (10s no-audio fallback)
  // Kling 2.6 duration-tiered pricing (5s/10s, audio doubles cost)
  "kling:5s": 138,                // (5s no audio)
  "kling:10s": 275,               // (10s no audio)
  "kling:5s:audio": 275,          // (5s with audio)
  "kling:10s:audio": 550,         // (10s with audio)
  "kling-turbo": 125,             // (5s fallback)
  // Kling Turbo duration-tiered pricing
  "kling-turbo:5s": 110,
  "kling-turbo:10s": 210,
  "kling-3.0": 500,               // (5s, audio, 1080P — 40 cr/sec) — fallback only
  // Kling 3.0 duration-tiered pricing (1080P, per-second: 27 no audio, 40 with audio)
  "kling-3.0:5s": 270,            // (1080P, no audio, 5s)
  "kling-3.0:10s": 680,           // (1080P, no audio, 10s)
  "kling-3.0:15s": 1020,          // (1080P, no audio, 15s)
  "kling-3.0:5s:audio": 338,      // (1080P, audio, 5s)
  "kling-3.0:10s:audio": 1000,    // (1080P, audio, 10s)
  "kling-3.0:15s:audio": 1500,    // (1080P, audio, 15s)
  "grok-i2v": 150,                 // (6s fallback)
  // Grok I2V duration-tiered pricing (shared with grok T2V)
  "grok-i2v:6s": 50,
  "grok-i2v:10s": 80,
  "grok-i2v:15s": 100,
  // ── Grok Imagine Video 1.5 (KIE) — per-second billing, 480p/720p, image-to-video. ──
  // KIE 14.5 cr/s @480p, 25 cr/s @720p, +2 cr/image (always 1 image → +2 in every tier).
  // Nodaro = ceil(KIE_total / 4) — same conversion as Seedance-2. Base = 8s/480p.
  "grok-imagine-video-1.5": 295,
  // 480p (KIE 14.5 cr/s + 2)
  "grok-imagine-video-1.5:1s:480p": 50,
  "grok-imagine-video-1.5:2s:480p": 80,
  "grok-imagine-video-1.5:3s:480p": 120,
  "grok-imagine-video-1.5:4s:480p": 150,
  "grok-imagine-video-1.5:5s:480p": 190,
  "grok-imagine-video-1.5:6s:480p": 230,
  "grok-imagine-video-1.5:7s:480p": 260,
  "grok-imagine-video-1.5:8s:480p": 300,
  "grok-imagine-video-1.5:9s:480p": 340,
  "grok-imagine-video-1.5:10s:480p": 370,
  "grok-imagine-video-1.5:11s:480p": 410,
  "grok-imagine-video-1.5:12s:480p": 440,
  "grok-imagine-video-1.5:13s:480p": 480,
  "grok-imagine-video-1.5:14s:480p": 520,
  "grok-imagine-video-1.5:15s:480p": 550,
  // 720p (KIE 25 cr/s + 2)
  "grok-imagine-video-1.5:1s:720p": 70,
  "grok-imagine-video-1.5:2s:720p": 130,
  "grok-imagine-video-1.5:3s:720p": 200,
  "grok-imagine-video-1.5:4s:720p": 260,
  "grok-imagine-video-1.5:5s:720p": 320,
  "grok-imagine-video-1.5:6s:720p": 380,
  "grok-imagine-video-1.5:7s:720p": 450,
  "grok-imagine-video-1.5:8s:720p": 510,
  "grok-imagine-video-1.5:9s:720p": 570,
  "grok-imagine-video-1.5:10s:720p": 630,
  "grok-imagine-video-1.5:11s:720p": 700,
  "grok-imagine-video-1.5:12s:720p": 760,
  "grok-imagine-video-1.5:13s:720p": 820,
  "grok-imagine-video-1.5:14s:720p": 880,
  "grok-imagine-video-1.5:15s:720p": 950,
  "seedance": 250,                 // (8s default; actual 3.5 KIE/sec)
  // Seedance duration-tiered pricing (/sec)
  "seedance:4s": 40,
  "seedance:8s": 70,
  "seedance:12s": 150,            // (actual from audit)
  // ── Seedance 2.0 — per-second billing, resolution × video-ref dimensions ──
  // Base fallback (8s/480p/no-ref)
  "seedance-2": 380,
  // 480p no video ref (/s)
  "seedance-2:4s:480p": 190,
  "seedance-2:8s:480p": 380,
  "seedance-2:12s:480p": 570,
  "seedance-2:15s:480p": 720,
  // 480p with video ref (/s)
  "seedance-2:4s:480p-ref": 120,
  "seedance-2:8s:480p-ref": 230,
  "seedance-2:12s:480p-ref": 350,
  "seedance-2:15s:480p-ref": 440,
  // 720p no video ref (/s)
  "seedance-2:4s:720p": 410,
  "seedance-2:8s:720p": 820,
  "seedance-2:12s:720p": 1230,
  "seedance-2:15s:720p": 1540,
  // 720p with video ref (/s)
  "seedance-2:4s:720p-ref": 250,
  "seedance-2:8s:720p-ref": 500,
  "seedance-2:12s:720p-ref": 750,
  "seedance-2:15s:720p-ref": 940,
  // 1080p — authoritative KIE rate is /s (no video) / 62 (with video)
  // ~2.49× the 720p rate (the original 1.5× estimate under-billed ~40%; KIE pricing
  // page verified 2026-06-25).
  "seedance-2:4s:1080p":  1020,
  "seedance-2:8s:1080p":  2040,
  "seedance-2:12s:1080p":  3060,
  "seedance-2:15s:1080p":  3830,   // → ceil
  // 1080p with video ref (/s)
  "seedance-2:4s:1080p-ref":   620,
  "seedance-2:8s:1080p-ref":  1240,
  "seedance-2:12s:1080p-ref":  1860,
  "seedance-2:15s:1080p-ref":  2330, // → ceil
  // 4K (/s no video / 128 with video) — full seedance-2 only.
  "seedance-2:4s:4k": 2080,
  "seedance-2:8s:4k": 4160,
  "seedance-2:12s:4k": 6240,
  "seedance-2:15s:4k": 7800,
  "seedance-2:4s:4k-ref": 1280,
  "seedance-2:8s:4k-ref": 2560,
  "seedance-2:12s:4k-ref": 3840,
  "seedance-2:15s:4k-ref": 4800,
  // ── Seedance 2.0 Fast — same matrix, lower rates ──
  "seedance-2-fast": 310,
  // 480p no video ref (/s)
  "seedance-2-fast:4s:480p": 160,
  "seedance-2-fast:8s:480p": 310,
  "seedance-2-fast:12s:480p": 470,
  "seedance-2-fast:15s:480p": 590,
  // 480p with video ref (/s)
  "seedance-2-fast:4s:480p-ref": 90,
  "seedance-2-fast:8s:480p-ref": 180,
  "seedance-2-fast:12s:480p-ref": 270,
  "seedance-2-fast:15s:480p-ref": 340,
  // 720p no video ref (/s)
  "seedance-2-fast:4s:720p": 330,
  "seedance-2-fast:8s:720p": 660,
  "seedance-2-fast:12s:720p": 990,
  "seedance-2-fast:15s:720p": 1240,
  // 720p with video ref (/s)
  "seedance-2-fast:4s:720p-ref": 200,
  "seedance-2-fast:8s:720p-ref": 400,
  "seedance-2-fast:12s:720p-ref": 600,
  "seedance-2-fast:15s:720p-ref": 750,
  // NOTE: seedance-2-fast has NO 1080p tier — KIE sells it at 480p/720p only
  // (verified KIE pricing page 2026-06-25, 4 SKUs). The full seedance-2 has 1080p/4K.
  // ── Seedance 2.0 Mini — budget tier, 480p/720p only, per-second × video-ref ──
  // Base fallback (8s/480p/no-ref)
  "seedance-2-mini": 190,
  // 480p no video ref (/s)
  "seedance-2-mini:4s:480p": 100,
  "seedance-2-mini:8s:480p": 190,
  "seedance-2-mini:12s:480p": 290,
  "seedance-2-mini:15s:480p": 360,
  // 480p with video ref (/s)
  "seedance-2-mini:4s:480p-ref": 60,
  "seedance-2-mini:8s:480p-ref": 120,
  "seedance-2-mini:12s:480p-ref": 180,
  "seedance-2-mini:15s:480p-ref": 230,
  // 720p no video ref (/s)
  "seedance-2-mini:4s:720p": 210,
  "seedance-2-mini:8s:720p": 410,
  "seedance-2-mini:12s:720p": 620,
  "seedance-2-mini:15s:720p": 770,
  // 720p with video ref (/s)
  "seedance-2-mini:4s:720p-ref": 130,
  "seedance-2-mini:8s:720p-ref": 250,
  "seedance-2-mini:12s:720p-ref": 380,
  "seedance-2-mini:15s:720p-ref": 470,
  // ── Seedance 2.5 — per-second billing, resolution × video-ref, 4-30s ──
  // KIE rates (kie.ai/model/bytedance/seedance-2-5, 2026-08-08), KIE cr/s:
  //   480p 28 no-video-ref / 17 with-video-ref; 720p 63 / 38; 1080p 114 / 68.5
  //   (1080p tier added 2026-08-17; 4k/2k/1440p still rejected).
  // Nodaro = ceil(rate x duration / 4) x 10 — the same credit conversion the
  // rest of the Seedance 2 family and minimax-h3 use.
  //
  // ONE TIER PER SECOND (4-30), not the 2.0 family's 4/8/12/15 ladder: the tier
  // lookup snaps UP and falls back to the LAST tier, so a coarse ladder over a
  // 30s range would reserve the 15s price for a 30s render — and commit_credits
  // only ever refunds a surplus, it can never collect an upward delta.
  //
  // "with video ref" is CHEAPER per second because KIE bills it as
  // rate x (input + output) seconds instead of rate x output. The full billed
  // span is reserved by seedance2RefVideoBaseCredits, which derives its
  // per-second rate from the 8s "-ref" composite below.
  //
  // Base fallback = 8s/720p/no-ref, the model's real KIE default (480p would
  // under-reserve an intent-less request; see PRICING_DEFAULT_RESOLUTION).
  "seedance-2-5": 1260,
  // 480p no video ref (/s)
  "seedance-2-5:4s:480p":   280,
  "seedance-2-5:5s:480p":   350,
  "seedance-2-5:6s:480p":   420,
  "seedance-2-5:7s:480p":   490,
  "seedance-2-5:8s:480p":   560,
  "seedance-2-5:9s:480p":   630,
  "seedance-2-5:10s:480p":   700,
  "seedance-2-5:11s:480p":   770,
  "seedance-2-5:12s:480p":   840,
  "seedance-2-5:13s:480p":   910,
  "seedance-2-5:14s:480p":   980,
  "seedance-2-5:15s:480p":  1050,
  "seedance-2-5:16s:480p":  1120,
  "seedance-2-5:17s:480p":  1190,
  "seedance-2-5:18s:480p":  1260,
  "seedance-2-5:19s:480p":  1330,
  "seedance-2-5:20s:480p":  1400,
  "seedance-2-5:21s:480p":  1470,
  "seedance-2-5:22s:480p":  1540,
  "seedance-2-5:23s:480p":  1610,
  "seedance-2-5:24s:480p":  1680,
  "seedance-2-5:25s:480p":  1750,
  "seedance-2-5:26s:480p":  1820,
  "seedance-2-5:27s:480p":  1890,
  "seedance-2-5:28s:480p":  1960,
  "seedance-2-5:29s:480p":  2030,
  "seedance-2-5:30s:480p":  2100,
  // 480p with video ref (/s)
  "seedance-2-5:4s:480p-ref":   170,
  "seedance-2-5:5s:480p-ref":   220,
  "seedance-2-5:6s:480p-ref":   260,
  "seedance-2-5:7s:480p-ref":   300,
  "seedance-2-5:8s:480p-ref":   340,
  "seedance-2-5:9s:480p-ref":   390,
  "seedance-2-5:10s:480p-ref":   430,
  "seedance-2-5:11s:480p-ref":   470,
  "seedance-2-5:12s:480p-ref":   510,
  "seedance-2-5:13s:480p-ref":   560,
  "seedance-2-5:14s:480p-ref":   600,
  "seedance-2-5:15s:480p-ref":   640,
  "seedance-2-5:16s:480p-ref":   680,
  "seedance-2-5:17s:480p-ref":   730,
  "seedance-2-5:18s:480p-ref":   770,
  "seedance-2-5:19s:480p-ref":   810,
  "seedance-2-5:20s:480p-ref":   850,
  "seedance-2-5:21s:480p-ref":   900,
  "seedance-2-5:22s:480p-ref":   940,
  "seedance-2-5:23s:480p-ref":   980,
  "seedance-2-5:24s:480p-ref":  1020,
  "seedance-2-5:25s:480p-ref":  1070,
  "seedance-2-5:26s:480p-ref":  1110,
  "seedance-2-5:27s:480p-ref":  1150,
  "seedance-2-5:28s:480p-ref":  1190,
  "seedance-2-5:29s:480p-ref":  1240,
  "seedance-2-5:30s:480p-ref":  1280,
  // 720p no video ref (/s)
  "seedance-2-5:4s:720p":   630,
  "seedance-2-5:5s:720p":   790,
  "seedance-2-5:6s:720p":   950,
  "seedance-2-5:7s:720p":  1110,
  "seedance-2-5:8s:720p":  1260,
  "seedance-2-5:9s:720p":  1420,
  "seedance-2-5:10s:720p":  1580,
  "seedance-2-5:11s:720p":  1740,
  "seedance-2-5:12s:720p":  1890,
  "seedance-2-5:13s:720p":  2050,
  "seedance-2-5:14s:720p":  2210,
  "seedance-2-5:15s:720p":  2370,
  "seedance-2-5:16s:720p":  2520,
  "seedance-2-5:17s:720p":  2680,
  "seedance-2-5:18s:720p":  2840,
  "seedance-2-5:19s:720p":  3000,
  "seedance-2-5:20s:720p":  3150,
  "seedance-2-5:21s:720p":  3310,
  "seedance-2-5:22s:720p":  3470,
  "seedance-2-5:23s:720p":  3630,
  "seedance-2-5:24s:720p":  3780,
  "seedance-2-5:25s:720p":  3940,
  "seedance-2-5:26s:720p":  4100,
  "seedance-2-5:27s:720p":  4260,
  "seedance-2-5:28s:720p":  4410,
  "seedance-2-5:29s:720p":  4570,
  "seedance-2-5:30s:720p":  4730,
  // 720p with video ref (/s)
  "seedance-2-5:4s:720p-ref":   380,
  "seedance-2-5:5s:720p-ref":   480,
  "seedance-2-5:6s:720p-ref":   570,
  "seedance-2-5:7s:720p-ref":   670,
  "seedance-2-5:8s:720p-ref":   760,
  "seedance-2-5:9s:720p-ref":   860,
  "seedance-2-5:10s:720p-ref":   950,
  "seedance-2-5:11s:720p-ref":  1050,
  "seedance-2-5:12s:720p-ref":  1140,
  "seedance-2-5:13s:720p-ref":  1240,
  "seedance-2-5:14s:720p-ref":  1330,
  "seedance-2-5:15s:720p-ref":  1430,
  "seedance-2-5:16s:720p-ref":  1520,
  "seedance-2-5:17s:720p-ref":  1620,
  "seedance-2-5:18s:720p-ref":  1710,
  "seedance-2-5:19s:720p-ref":  1810,
  "seedance-2-5:20s:720p-ref":  1900,
  "seedance-2-5:21s:720p-ref":  2000,
  "seedance-2-5:22s:720p-ref":  2090,
  "seedance-2-5:23s:720p-ref":  2190,
  "seedance-2-5:24s:720p-ref":  2280,
  "seedance-2-5:25s:720p-ref":  2380,
  "seedance-2-5:26s:720p-ref":  2470,
  "seedance-2-5:27s:720p-ref":  2570,
  "seedance-2-5:28s:720p-ref":  2660,
  "seedance-2-5:29s:720p-ref":  2760,
  "seedance-2-5:30s:720p-ref":  2850,
  // 1080p no video ref (/s) — added 2026-08-17 (KIE 1080P release)
  "seedance-2-5:4s:1080p":  1140,
  "seedance-2-5:5s:1080p":  1430,
  "seedance-2-5:6s:1080p":  1710,
  "seedance-2-5:7s:1080p":  2000,
  "seedance-2-5:8s:1080p":  2280,
  "seedance-2-5:9s:1080p":  2570,
  "seedance-2-5:10s:1080p":  2850,
  "seedance-2-5:11s:1080p":  3140,
  "seedance-2-5:12s:1080p":  3420,
  "seedance-2-5:13s:1080p":  3710,
  "seedance-2-5:14s:1080p":  3990,
  "seedance-2-5:15s:1080p":  4280,
  "seedance-2-5:16s:1080p":  4560,
  "seedance-2-5:17s:1080p":  4850,
  "seedance-2-5:18s:1080p":  5130,
  "seedance-2-5:19s:1080p":  5420,
  "seedance-2-5:20s:1080p":  5700,
  "seedance-2-5:21s:1080p":  5990,
  "seedance-2-5:22s:1080p":  6270,
  "seedance-2-5:23s:1080p":  6560,
  "seedance-2-5:24s:1080p":  6840,
  "seedance-2-5:25s:1080p":  7130,
  "seedance-2-5:26s:1080p":  7410,
  "seedance-2-5:27s:1080p":  7700,
  "seedance-2-5:28s:1080p":  7980,
  "seedance-2-5:29s:1080p":  8270,
  "seedance-2-5:30s:1080p":  8550,
  // 1080p with video ref (/s)
  "seedance-2-5:4s:1080p-ref":   690,
  "seedance-2-5:5s:1080p-ref":   860,
  "seedance-2-5:6s:1080p-ref":  1030,
  "seedance-2-5:7s:1080p-ref":  1200,
  "seedance-2-5:8s:1080p-ref":  1370,
  "seedance-2-5:9s:1080p-ref":  1550,
  "seedance-2-5:10s:1080p-ref":  1720,
  "seedance-2-5:11s:1080p-ref":  1890,
  "seedance-2-5:12s:1080p-ref":  2060,
  "seedance-2-5:13s:1080p-ref":  2230,
  "seedance-2-5:14s:1080p-ref":  2400,
  "seedance-2-5:15s:1080p-ref":  2570,
  "seedance-2-5:16s:1080p-ref":  2740,
  "seedance-2-5:17s:1080p-ref":  2920,
  "seedance-2-5:18s:1080p-ref":  3090,
  "seedance-2-5:19s:1080p-ref":  3260,
  "seedance-2-5:20s:1080p-ref":  3430,
  "seedance-2-5:21s:1080p-ref":  3600,
  "seedance-2-5:22s:1080p-ref":  3770,
  "seedance-2-5:23s:1080p-ref":  3940,
  "seedance-2-5:24s:1080p-ref":  4110,
  "seedance-2-5:25s:1080p-ref":  4290,
  "seedance-2-5:26s:1080p-ref":  4460,
  "seedance-2-5:27s:1080p-ref":  4630,
  "seedance-2-5:28s:1080p-ref":  4800,
  "seedance-2-5:29s:1080p-ref":  4970,
  "seedance-2-5:30s:1080p-ref":  5140,
  // ── MiniMax Hailuo 3 — per-second billing at two resolution rates ──
  // KIE 36.5 cr/s @2K (default) and 22.5 cr/s @768P (lever added 2026-08-03);
  // Nodaro = ceil(rate × duration / 4) × 10 (same conversion as Seedance-2). One
  // seeded tier per allowed second (4-15s); bare ids are the 2K rate
  // (byte-identical to the pre-lever rows), ":768p" appends the cheaper tier.
  // Reference-video runs bill unit × (input + output) seconds AT THE SELECTED
  // resolution's rate, and input images beyond the first 5 add 11 KIE cr
  // (27.5 credits) each — both reserved via the minimax-h3-credits
  // computeCredits hook, NOT via extra composites. Reference audio is free.
  // Base fallback = 6s @2K (the KIE default duration + resolution).
  "minimax-h3": 550,
  "minimax-h3:4s": 370,
  "minimax-h3:5s": 460,
  "minimax-h3:6s": 550,
  "minimax-h3:7s": 640,
  "minimax-h3:8s": 730,
  "minimax-h3:9s": 830,
  "minimax-h3:10s": 920,
  "minimax-h3:11s": 1010,
  "minimax-h3:12s": 1100,
  "minimax-h3:13s": 1190,
  "minimax-h3:14s": 1280,
  "minimax-h3:15s": 1370,
  "minimax-h3:4s:768p": 230,
  "minimax-h3:5s:768p": 290,
  "minimax-h3:6s:768p": 340,
  "minimax-h3:7s:768p": 400,
  "minimax-h3:8s:768p": 450,
  "minimax-h3:9s:768p": 510,
  "minimax-h3:10s:768p": 570,
  "minimax-h3:11s:768p": 620,
  "minimax-h3:12s:768p": 680,
  "minimax-h3:13s:768p": 740,
  "minimax-h3:14s:768p": 790,
  "minimax-h3:15s:768p": 850,
  // ── Gemini Omni Video (KIE) —; Nodaro. Lowercase 4k. ──
  "gemini-omni-video": 315,         // base = 720p/1080p 4s
  "gemini-omni-video:4": 230,
  "gemini-omni-video:6": 300,
  "gemini-omni-video:8": 380,
  "gemini-omni-video:10": 450,
  "gemini-omni-video:4k:4": 530,
  "gemini-omni-video:4k:6": 600,
  "gemini-omni-video:4k:8": 680,
  "gemini-omni-video:4k:10": 750,
  "gemini-omni-video:vref": 600,    // (video-edit, flat)
  "gemini-omni-video:4k:vref": 900,// (video-edit 4K, flat)
  "wan-i2v": 175,                 // (5s 720p fallback)
  // Wan I2V duration-tiered pricing (720p default)
  "wan-i2v:5s": 180,
  "wan-i2v:10s": 350,
  "wan-i2v:15s": 530,
  "wan-turbo": 100,               // (5s, 480p I2V default)
  "hailuo-2.3-pro": 200,          // (10s fallback, actual from audit)
  // Hailuo 2.3 Pro duration-tiered pricing (768p default)
  "hailuo-2.3-pro:6s": 130,       // (estimated from audit)
  "hailuo-2.3-pro:10s": 200,      // (actual from audit)
  "hailuo-2.3": 75,              // (6s fallback)
  // Hailuo 2.3 duration-tiered pricing
  "hailuo-2.3:6s": 80,
  "hailuo-2.3:10s": 130,
  "hailuo-standard": 75,         // (6s fallback)
  // Hailuo Standard duration-tiered pricing
  "hailuo-standard:6s": 80,
  "hailuo-standard:10s": 130,
  "bytedance-lite": 57,            // (actual from audit)
  "bytedance-pro": 175,            // (actual from audit)
  "bytedance-pro-fast": 90,       // (actual from audit)
  "kling-master": 400,            // (5s fallback)
  // Kling Master duration-tiered pricing
  "kling-master:5s": 400,
  "kling-master:10s": 800,
  "kling-3-omni": 250,            // Replicate, est (5s 720p fallback)
  // Kling 3 Omni duration-tiered pricing (Replicate, estimated — actual cost tracked via predict_time)
  "kling-3-omni:5s": 250,         // est
  "kling-3-omni:10s": 500,        // est
  "kling-3-omni:15s": 750,        // est
  // ── Lightricks LTX 2.3 (Replicate) — official pricing from replicate.com/lightricks/ltx-2.3-{pro,fast} ──
  // Per-second of output video: Pro (1080p/2k/4k), Fast
  // Formula: per second × duration → cr/sec: Pro Fast
  // Pro: text/image/audio→video, 1080p/2k/4k, durations s. Base = 1080p:6s.
  "ltx-2.3-pro": 240,             // default = 1080p:6s
  "ltx-2.3-pro:1080p:6s": 240,    // → ceil = 30
  "ltx-2.3-pro:1080p:8s": 320,
  "ltx-2.3-pro:1080p:10s": 400,
  "ltx-2.3-pro:2k:6s": 480,
  "ltx-2.3-pro:2k:8s": 640,
  "ltx-2.3-pro:2k:10s": 800,
  "ltx-2.3-pro:4k:6s": 960,
  "ltx-2.3-pro:4k:8s": 1280,
  "ltx-2.3-pro:4k:10s": 1600,
  // Fast: text/image→video, 1080p/2k/4k, durations 6–20s (1080p only past 10s). Base = 1080p:6s.
  "ltx-2.3-fast": 180,            // default = 1080p:6s
  "ltx-2.3-fast:1080p:6s": 180,   // ceil = ceil(22.5)
  "ltx-2.3-fast:1080p:8s": 240,
  "ltx-2.3-fast:1080p:10s": 300,
  "ltx-2.3-fast:1080p:12s": 360,
  "ltx-2.3-fast:1080p:14s": 420,
  "ltx-2.3-fast:1080p:16s": 480,
  "ltx-2.3-fast:1080p:18s": 540,
  "ltx-2.3-fast:1080p:20s": 600,
  "ltx-2.3-fast:2k:6s": 360,      // ceil = 45
  "ltx-2.3-fast:2k:8s": 480,
  "ltx-2.3-fast:2k:10s": 600,
  "ltx-2.3-fast:4k:6s": 720,      // = 90
  "ltx-2.3-fast:4k:8s": 960,
  "ltx-2.3-fast:4k:10s": 1200,
  // LTX extend + retake (Pro only, 1080p): per-second × duration at credit-guard time.
  // 5 cr/sec matches Pro:1080p rate (extend output is at the input's resolution; retake is locked 1080p).
  "ltx-2.3-pro-extend:per-second": 40,
  // ── Seedance 2 Extend — trim-stitch continuation of ANY video (rates =
  //    seedance-2 -ref matrix + 3cr ffmpeg stitch; spike findings 2026-06-11) ──
  "seedance-2-extend": 530,             // default 8s 720p
  "seedance-2-extend:4s:480p": 150,
  "seedance-2-extend:8s:480p": 260,
  "seedance-2-extend:12s:480p": 380,
  "seedance-2-extend:15s:480p": 470,
  "seedance-2-extend:4s:720p": 280,
  "seedance-2-extend:8s:720p": 530,
  "seedance-2-extend:12s:720p": 780,
  "seedance-2-extend:15s:720p": 970,
  "seedance-2-extend:4s:1080p":   410,
  "seedance-2-extend:8s:1080p":   780,
  "seedance-2-extend:12s:1080p":  1160,
  "seedance-2-extend:15s:1080p":  1440,
  "ltx-2.3-pro-retake:per-second": 40,
  "runway-kie": 30,               // (5s, 720p)
  // ── Video Extend ──
  "veo-extend": 190,              // (VEO 3.1 Fast default)
  "veo-extend:quality": 790,      // (VEO 3.1 Quality)
  "runway-extend": 320,           // (Runway extend)
  // ── VEO Upscale ──
  "veo-1080p": 20,                // (VEO 3.1 1080p)
  "veo-4k": 380,                  // (VEO 3.1 4K)
  // ── Video-to-Video / Motion ──
  "wan": 175,                     // (V2V 5s 720p)
  "wan-flash": 100,               // est (Flash V2V, faster)
  "wan-videoedit": 320,
  "wan-t2v": 270,                 // (T2V 5s 1080p default)
  "wan-turbo-t2v": 200,           // (T2V 5s 720p default)
  // Wan 2.7 T2I — 1K/2K/4K (estimated, adjust after audit-credits post-ship)
  "wan-2.7": 20,        // (1K default)
  "wan-2.7:2K": 40,     // ( est.)
  "wan-2.7:4K": 80,    // ( est.)

  // Wan 2.7 Pro T2I — 1K/2K/4K (estimated)
  "wan-2.7-pro": 120,        // (1K)
  "wan-2.7-pro:2K": 60,     // ( est.)
  "wan-2.7-pro:4K": 120,    // ( est.)

  // ⚠️ UNDERCHARGE (deferred — needs owner cost data): the wan-2.7-i2v/t2v
  // entries below are FLAT prices for "5s 720p", but the nodes expose 2–15s
  // durations and 720p/1080p (KIE default 1080p). wan-2.7 is NOT in
  // DURATION_PRICED_PROVIDERS / VIDEO_DURATION_TIERS / the resolution-tier sets
  // (model-constants.ts), so buildVideoCreditModelIdentifier returns the bare
  // key and any duration/res is charged the 5s-720p flat rate — an undercharge
  // vs KIE (the sibling wan-i2v correctly tiers 5/10/15s). FIX requires KIE's
  // actual per-duration/per-1080p rates for wan-2.7 (NOT published in the
  // OpenAPI docs / dashboard only); do NOT guess linear — if KIE bills
  // flat-per-generation, linear tiers would OVERCHARGE users on long clips.
  // Wire tiers + composite keys (mirror wan-i2v / happyhorse) once rates are
  // confirmed, then run `audit-credits`.

  // Wan 2.7 I2V (estimated)
  "wan-2.7-i2v": 188,    // (5s 720p)

  // Wan 2.7 T2V (estimated)
  "wan-2.7-t2v": 188,    // (5s 720p)

  // HappyHorse 1.1 (t2v / i2v / ref2v) — true per-second billing, published on
  // kie.ai/happyhorse-1-1: 22.5 KIE cr/s @720p, 29 KIE cr/s @1080p, identical
  // across all three modes. Seeded per (duration × resolution) like
  // grok-imagine-video-1.5; base fallback = 5s @720p.
  "happyhorse": 282,        // (5s 720p fallback)
  // 720p — ceil(22.5 × s ÷ 4)
  "happyhorse:3s:720p": 170, "happyhorse:4s:720p": 230, "happyhorse:5s:720p": 290,
  "happyhorse:6s:720p": 340, "happyhorse:7s:720p": 400, "happyhorse:8s:720p": 450,
  "happyhorse:9s:720p": 510, "happyhorse:10s:720p": 570, "happyhorse:11s:720p": 620,
  "happyhorse:12s:720p": 680, "happyhorse:13s:720p": 740, "happyhorse:14s:720p": 790,
  "happyhorse:15s:720p": 850,
  // 1080p — ceil(29 × s ÷ 4)
  "happyhorse:3s:1080p":   220, "happyhorse:4s:1080p": 290, "happyhorse:5s:1080p": 370,
  "happyhorse:6s:1080p":   440, "happyhorse:7s:1080p": 510, "happyhorse:8s:1080p": 580,
  "happyhorse:9s:1080p":   660, "happyhorse:10s:1080p": 730, "happyhorse:11s:1080p": 800,
  "happyhorse:12s:1080p":   870, "happyhorse:13s:1080p": 950, "happyhorse:14s:1080p": 1020,
  "happyhorse:15s:1080p":  1090,
  "happyhorse-i2v": 282,    // (5s 720p fallback)
  "happyhorse-i2v:3s:720p": 170, "happyhorse-i2v:4s:720p": 230, "happyhorse-i2v:5s:720p": 290,
  "happyhorse-i2v:6s:720p": 340, "happyhorse-i2v:7s:720p": 400, "happyhorse-i2v:8s:720p": 450,
  "happyhorse-i2v:9s:720p": 510, "happyhorse-i2v:10s:720p": 570, "happyhorse-i2v:11s:720p": 620,
  "happyhorse-i2v:12s:720p": 680, "happyhorse-i2v:13s:720p": 740, "happyhorse-i2v:14s:720p": 790,
  "happyhorse-i2v:15s:720p": 850,
  "happyhorse-i2v:3s:1080p":   220, "happyhorse-i2v:4s:1080p": 290, "happyhorse-i2v:5s:1080p": 370,
  "happyhorse-i2v:6s:1080p":   440, "happyhorse-i2v:7s:1080p": 510, "happyhorse-i2v:8s:1080p": 580,
  "happyhorse-i2v:9s:1080p":   660, "happyhorse-i2v:10s:1080p": 730, "happyhorse-i2v:11s:1080p": 800,
  "happyhorse-i2v:12s:1080p":   870, "happyhorse-i2v:13s:1080p": 950, "happyhorse-i2v:14s:1080p": 1020,
  "happyhorse-i2v:15s:1080p":  1090,
  "happyhorse-ref2v": 282,  // (5s 720p fallback)
  "happyhorse-ref2v:3s:720p": 170, "happyhorse-ref2v:4s:720p": 230, "happyhorse-ref2v:5s:720p": 290,
  "happyhorse-ref2v:6s:720p": 340, "happyhorse-ref2v:7s:720p": 400, "happyhorse-ref2v:8s:720p": 450,
  "happyhorse-ref2v:9s:720p": 510, "happyhorse-ref2v:10s:720p": 570, "happyhorse-ref2v:11s:720p": 620,
  "happyhorse-ref2v:12s:720p": 680, "happyhorse-ref2v:13s:720p": 740, "happyhorse-ref2v:14s:720p": 790,
  "happyhorse-ref2v:15s:720p": 850,
  "happyhorse-ref2v:3s:1080p":   220, "happyhorse-ref2v:4s:1080p": 290, "happyhorse-ref2v:5s:1080p": 370,
  "happyhorse-ref2v:6s:1080p":   440, "happyhorse-ref2v:7s:1080p": 510, "happyhorse-ref2v:8s:1080p": 580,
  "happyhorse-ref2v:9s:1080p":   660, "happyhorse-ref2v:10s:1080p": 730, "happyhorse-ref2v:11s:1080p": 800,
  "happyhorse-ref2v:12s:1080p":   870, "happyhorse-ref2v:13s:1080p": 950, "happyhorse-ref2v:14s:1080p": 1020,
  "happyhorse-ref2v:15s:1080p":  1090,
  // HappyHorse Edit stays on the 1.0 endpoint (1.1 has no video-edit mode).
  // KIE bills per second (published: 28 cr/s @720p, 48 cr/s @1080p) but the
  // input clip's duration isn't known at reservation time (the v2v route has
  // no duration probe), so this is a flat 5s-@720p-equivalent: ceil(28×5÷4).
  // The render default is pinned to 720p in kie/models.ts to match. Longer
  // inputs still under-bill — wiring duration-aware pricing needs an input
  // probe (deferred; watch `audit-credits`).
  "happyhorse-edit": 350,
  "luma-modify": 320,             // (not in KIE pricing data)
  "runway-aleph": 350,             // (V2V conversion)
  "topaz-video": 190,             // (12 cr/sec * ~5s)
  // ── Motion Transfer (per-second pricing, duration-tiered) ──
  // Kling 3.0 720p: /sec
  "kling-3.0-motion": 300,        // 10s default
  "kling-3.0-motion:5s": 150,
  "kling-3.0-motion:10s": 300,
  "kling-3.0-motion:15s": 450,
  "kling-3.0-motion:30s": 900,
  // Kling 3.0 1080p: /sec
  "kling-3.0-motion:1080p": 500,  // 10s default
  "kling-3.0-motion:1080p:5s": 250,
  "kling-3.0-motion:1080p:10s": 500,
  "kling-3.0-motion:1080p:15s": 750,
  "kling-3.0-motion:1080p:30s": 1500,
  // Kling 2.6 720p: /sec
  "motion-transfer": 150,         // 10s default:, (Kling 2.6 720p)
  "kling-motion": 150,            // alias
  "motion-transfer:5s": 80,
  "motion-transfer:10s": 150,
  "motion-transfer:15s": 230,
  "motion-transfer:30s": 450,
  // Kling 2.6 1080p: /sec
  "motion-transfer:1080p": 230,   // 10s default
  "motion-transfer:1080p:5s": 120,
  "motion-transfer:1080p:10s": 230,
  "motion-transfer:1080p:15s": 340,
  "motion-transfer:1080p:30s": 680,
  // Wan Animate (Move + Replace) — resolution-tiered pricing
  "wan-animate-move": 255,         // (480p default, actual from audit)
  "wan-animate-move:580p": 330,    // (interpolated from audit)
  "wan-animate-move:720p": 410,    // (actual from audit)
  "wan-animate-replace": 255,      // (480p default, same as move)
  "wan-animate-replace:580p": 330, // (interpolated)
  "wan-animate-replace:720p": 410, // (same as move)
  // ── Lip Sync ──
  // Kling AI Avatar 2.0 (May 2026) supports up to 5min audio, billed per-second
  // by KIE at 8 cr/sec (Standard, 720p) and 16 cr/sec (Pro, 1080p).
  // Composite identifiers `<provider>:<bucket>s` map to ceil(bucket × Nodaro-rate).
  // Nodaro rates: 2 cr/sec Standard, 4 cr/sec Pro (matches pre-upgrade ~14s flat).
  // Bare keys remain for back-compat — callers without audioDurationSec hit them.
  "kling-avatar": 280,             // legacy default ~14s
  "kling-avatar:15s": 300,         // 15s × 2 cr/sec
  "kling-avatar:30s": 600,         // 30s × 2 cr/sec
  "kling-avatar:60s": 1200,        // 60s × 2 cr/sec
  "kling-avatar:120s": 2400,       // 120s × 2 cr/sec
  "kling-avatar:300s": 6000,       // 300s × 2 cr/sec — 5-min ceiling
  "kling-avatar-pro": 560,         // legacy default ~14s
  "kling-avatar-pro:15s": 600,     // 15s × 4 cr/sec
  "kling-avatar-pro:30s": 1200,    // 30s × 4 cr/sec
  "kling-avatar-pro:60s": 2400,    // 60s × 4 cr/sec
  "kling-avatar-pro:120s": 4800,   // 120s × 4 cr/sec
  "kling-avatar-pro:300s": 12000,  // 300s × 4 cr/sec — 5-min ceiling
  // OmniHuman 1.5 — /sec → ceil(27×s/4). Bare = worst-case 60s
  // (reserved on unknown-duration workflow runs; reconciled down by the worker).
  "omnihuman-1-5": 4050,
  "omnihuman-1-5:15s": 1020,
  "omnihuman-1-5:30s": 2030,
  "omnihuman-1-5:60s": 4050,
  // HeyGen Lipsync Precision + Sync Lipsync 2 Pro (Replicate, video-input dubbing).
  // Billed per second of output; bucketed like kling-avatar via buildLipSyncCreditId.
  // Base (markup applies at read time): credits. lip-sync
  // sets no meteredCost, so the worker commits the reserved bucket as the charge.
  "heygen-lipsync-precision": 10010,      // bare = 300s ceiling
  "heygen-lipsync-precision:15s": 510,    // 15s ×
  "heygen-lipsync-precision:30s": 1010,   // 30s ×
  "heygen-lipsync-precision:60s": 2010,   // 60s ×
  "heygen-lipsync-precision:120s": 4010,  // 120s ×
  "heygen-lipsync-precision:300s": 10010, // 300s × — 5-min ceiling
  "lipsync-2-pro": 12490,                 // bare = 300s ceiling
  "lipsync-2-pro:15s": 630,               // 15s ×
  "lipsync-2-pro:30s": 1250,              // 30s ×
  "lipsync-2-pro:60s": 2500,              // 60s ×
  "lipsync-2-pro:120s": 5000,             // 120s ×
  "lipsync-2-pro:300s": 12490,            // 300s × — 5-min ceiling
  // Sync Lipsync v3 (fal.ai). /min, billed per output second
  // bucketed via buildLipSyncCreditId. Base: credits =
  // . lip-sync sets no meteredCost, so the
  // reserved bucket is committed verbatim as the charge.
  "sync-lipsync-v3": 20000,               // bare = 300s ceiling
  "sync-lipsync-v3:15s": 1000,            // 15s ×
  "sync-lipsync-v3:30s": 2000,            // 30s ×
  "sync-lipsync-v3:60s": 4000,            // 60s ×
  "sync-lipsync-v3:120s": 8000,           // 120s ×
  "sync-lipsync-v3:300s": 20000,          // 300s × — 5-min ceiling
  // Volcengine video-to-video lip sync (KIE). (/sec) — identical
  // to kling-avatar — billed per output second, bucketed via buildLipSyncCreditId.
  // Base (matches kling-avatar + the per-second lip-sync family): credits =
  // = 2 cr/sec. lip-sync sets no meteredCost, so
  // the reserved bucket is committed verbatim as the charge.
  "volcengine-lipsync": 6000,             // bare = 300s ceiling
  "volcengine-lipsync:15s": 300,          // 15s ×
  "volcengine-lipsync:30s": 600,          // 30s ×
  "volcengine-lipsync:60s": 1200,         // 60s ×
  "volcengine-lipsync:120s": 2400,        // 120s ×
  "volcengine-lipsync:300s": 6000,        // 300s × — 5-min ceiling
  // ── Replicate MMAudio (video-sfx node) ──
  // BASE credits (pre-markup). creditGuard applies cost_markup_percent at request time.
  "replicate-mmaudio":       10,  // base/legacy default (8s bucket)
  "replicate-mmaudio:8s":    10,
  "replicate-mmaudio:15s":   10,
  "replicate-mmaudio:30s":   20,
  "replicate-mmaudio:60s":   30,
  "replicate-mmaudio:120s":  50,
  "replicate-mmaudio:300s": 110,
  "hailuo-avatar": 190,           // estimated (not in KIE pricing data)
  // ── Audio / TTS / Music ──
  "elevenlabs-v3": 30,             // direct ElevenLabs API
  "elevenlabs-turbo": 15,         // per 1K chars
  "elevenlabs-multilingual": 30,  // per 1K chars
  "elevenlabs": 15,               // alias for turbo
  "elevenlabs-sfx": 3,           // 0.24 cr/sec * ~5s
  // Replicate disabled
  // "tangoflux": 4, // Replicate SFX, estimated
  "suno": 30,                     // (V4 default) — base
  "suno-v5": 30,                  // (V5)
  "suno-v5_5": 30,                // (V5.5)
  "suno-generate": 30,            // (V4 default)
  "suno-cover": 30,
  "suno-extend": 30,
  "suno-lyrics": 10,
  "suno-separate": 40,            // matches model_pricing (mig 059); held by re-baseline (unclear)
  "suno-separate-stem": 130,      // base
  "audio-separation": 30,         // Demucs (ryan5453) on Replicate, fixed reserved tier (Auto/Fast)
  "audio-separation:best": 80,    // htdemucs_ft (~4× compute), fixed reserved tier
  "audio-separation:stems": 60,   // htdemucs_6s (6-stem, heavier than base) — conservative estimate, tune via audit-credits
  "suno-music-video": 10,         // matches model_pricing (mig 059)
  "suno-mashup": 30,
  "suno-replace-section": 20,
  "suno-style-boost": 10,
  "suno-add-instrumental": 30,
  "suno-add-vocals": 30,
  "suno-convert-wav": 10,
  "suno-upload-extend": 30,
  "suno-voice-create": 200,       // One-time persona creation (validate + generate); KIE does not publish pricing — flat conservative default
  // Replicate disabled
  // "musicgen": 7,                 // Replicate Meta MusicGen
  // "lyria": 7,                    // Replicate Google Lyria 2
  // "bark": 7,                     // Replicate Suno Bark
  "elevenlabs-isolation": 74,     // /sec, variable; ~148s avg = (from audit)
  // Replicate disabled
  // "whisper": 4,                   // Replicate whisper transcription
  // "incredibly-fast-whisper": 4,   // Replicate fast whisper
  "elevenlabs-stt": 22,           // avg (from audit)
  "elevenlabs-dialogue": 25,     // per 1K chars
  "voice-clone": 50,              // ElevenLabs instant voice clone
  "elevenlabs-voice-changer": 40,  // ElevenLabs speech-to-speech
  "elevenlabs-dubbing": 80,        // ElevenLabs dubbing (async)
  "elevenlabs-voice-remix": 40,    // ElevenLabs voice remix/preview
  "elevenlabs-voice-design": 50,   // ElevenLabs voice design (full controls)
  "elevenlabs-forced-alignment": 30, // ElevenLabs forced alignment
  "infinitalk": 420,              // fallback (720p default)
  "infinitalk:480p": 110,         // (3 cr/sec * ~14s)
  "infinitalk:720p": 420,         // (12 cr/sec * ~14s)
  // ── Speech-to-Video ──
  "speech-to-video": 30,           // (480p)
  "speech-to-video:580p": 50,
  "speech-to-video:720p": 60,
  // ── Processing ──
  "topaz": 120,                     // processing
  "ffmpeg": 10,
  "render-video": 50,            // Remotion compute
  // Replicate disabled
  // "runway": 20, // Replicate, typical
  // "pika": 20, // Replicate, typical
  // ── LLM (standard tier = base entry, economy = 0.5x min 1, premium = 3x) ──
  "prompt-helper": 7,            // standard
  "prompt-helper:economy": 1,
  "prompt-helper:premium": 7,    // base (Opus 4.7)
  "ai-writer": 4,                // standard (base)
  "ai-writer:economy": 1,
  "ai-writer:premium": 2,        // Opus 4.7
  "llm-chat": 2,                 // standard (base)
  "llm-chat:economy": 1,
  "llm-chat:premium": 6,         // Opus 4.7
  // Workflow Copilot turn: RESERVATION CEILING, not a price. The turn is
  // metered (commitJobCredits metered=true → actual model usage × the
  // identifier's service rate) and `commit_credits` can only refund surplus,
  // so the loop keeps its spend under this ceiling. Single identifier: the
  // copilot runs one model; tiers are not exposed.
  "workflow-copilot": 900,
  // The model ladder's reservation ceilings (migration 344) — the turn still
  // commits METERED actuals; these only scale what is reserved up front.
  "workflow-copilot:economy": 300,
  "workflow-copilot:premium": 2700,
  "translate": 10,                // internal utility (replicate i2i prompt translation)
  "translate:economy": 10,
  "translate:premium": 10,
  "scene-graph-ai": 30,          // standard
  "scene-graph-ai:economy": 10,
  "scene-graph-ai:premium": 40,
  "video-composer": 30,          // standard
  "video-composer:economy": 10,
  "video-composer:premium": 40,
  "after-effects": 20,           // standard
  "after-effects:economy": 10,
  "after-effects:premium": 20,
  "lottie-overlay": 5,          // standard
  "lottie-overlay:economy": 10,
  "lottie-overlay:premium": 20,
  "3d-title": 20,                // standard
  "3d-title:economy": 10,
  "3d-title:premium": 40,
  "motion-graphics": 10,         // standard
  "motion-graphics:economy": 10,
  "motion-graphics:premium": 30,
  "motion-graphics-lottie": 33,         // standard (Sonnet 4.6, ~3K in + 4K out)
  "motion-graphics-lottie:economy": 1,
  "motion-graphics-lottie:premium": 80, // Opus 4.7 at the lottie token profile
  ...PINNABLE_SCRIPT_LLM_STATIC,
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
  // ── Choose Best (reduce) — strategy-tiered pricing ──
  // Pure logic strategies are free; pick-best-llm pays for an AI judge call and
  // its price follows the chosen judge model's tier like every other LLM node
  // (buildLlmCreditIdentifier over the "reduce:pick-best-llm" feature id):
  // economy → :economy, standard → bare, premium → :premium. The composite key
  // is built from the node's `data.strategyId` (+ strategyConfig.llmModel) via
  // the CREDIT_COSTS["reduce"] resolver below. There is no base "reduce" entry —
  // the route always reads strategyId and resolves to a composite identifier.
  "reduce:pick-best-llm": 10,
  "reduce:pick-best-llm:economy": 3,
  "reduce:pick-best-llm:premium": 25,
  "reduce:concat": 0,
  "reduce:first-non-empty": 0,
  "reduce:count": 0,
  "reduce:vote": 0,
  "reduce:merge-json": 0,
  // ── Node types (additional entries for workflow estimation by node.type) ──
  "generate-script": 20,
  "generate-script:economy": 10,
  "generate-script:premium": 30,
  // ── Video Director (HyperFrames Phase 1) — fixed model: claude-sonnet-4.6 (standard) ──
  // No :economy/:premium composites — the authoring model is not user-selectable.
  // Math: ~6K input × /M + ~8K output × /M = → × → ceil = 9
  "video-director": 90,
  "generate-image": 20,
  "edit-image": 20,
  "image-to-image": 20,
  "modify-image": 20,
  "upscale-image": 10,
  "remove-background": 10,
  // Bare-id fallback reserves (fire only when no duration-composite matches).
  // Re-sized 2026-07-30 to cover observed composite actuals (29-47 cr) — the
  // old 25 sat below the real worst case. Commit meters down to actual.
  "image-to-video": 500,
  "video-to-video": 250,
  "text-to-video": 500,
  "text-to-speech": 30,
  "generate-music": 180,
  "text-to-audio": 30,
  "lip-sync": 130,
  "latentsync": 7,
  "wav2lip": 10,
  "video-retalking": 200,
  "sadtalker": 50,
  "video-upscale": 150,
  "extend-video": 400,
  // LTX 2.3 Pro retake — fallback for node-registry display and any
  // defensive lookups when the route's computeCredits hook isn't reached.
  // Real reservation uses `ltx-2.3-pro-retake:per-second × retakeDuration`.
  "video-retake": 1000,
  "roop-face-swap": 130,           // Replicate ×
  "generate-mask": 50,             // adirik/grounded-sam (Replicate) — segmentation mask
  "transcribe": 10,
  // ── Web Scrape (Apify + direct RSS) ──
  "web-scrape": 20,
  "web-scrape:google-search": 30,
  "web-scrape:content-crawler": 10,
  "web-scrape:content-crawler:site": 50,
  "web-scrape:instagram": 10,
  "web-scrape:tiktok": 10,
  "web-scrape:rss": 10,
  "qa-check": 10,
  "qa-check:economy": 1,
  "qa-check:premium": 10,
  // ── Dynamic-priced video utilities (NOT used by routes, but kept as
  //    safety-net fallback). The three rows below are unreachable when
  //    routes/loop-video.ts, routes/trim-video.ts, routes/combine-videos.ts
  //    use the computeCredits hook in creditGuard. Their model_pricing rows
  //    (also 0) are likewise unreachable.
  "combine-videos": 30,
  // Image Collage — composites N images into one 2K/4K image (local ffmpeg,
  // no provider cost). Priced by resolution. Base + resolution composites;
  // the single-node route uses computeCredits, workflow runs reserve the
  // composite via the payload-builder modelIdentifier. See migration 244.
  "image-collage": 20,
  "image-collage:2K": 20,
  "image-collage:4K": 40,
  // Assemble Narrated Video — fits N ordered (clip, voice) blocks into one
  // MP4 via ffmpeg (local compute, no external provider cost). BASE credits
  // (pre-markup) is the 6-block case: 3 + ceil = 4. The route scales
  // with block count via computeCredits (assembleNarratedVideoCredits).
  // See migration 246.
  "assemble-narrated-video": 40,
  "merge-video-audio": 20,
  "add-captions": 30,
  "add-captions:kinetic": 50,
  "resize-video": 20,
  "trim-audio": 10,
  "split-media": 20,
  "extract-audio": 10,
  "remove-audio": 20,
  "mix-audio": 20,
  "combine-audio": 10,
  "adjust-volume": 10,
  "audio-fx": 20,                  // Demucs-free FFmpeg audio effects (reverb/EQ/echo)
  "trim-video": 10,
  "extract-frame": 10,
  "speed-ramp": 20,
  "speed-ramp:smooth": 50, // motion-compensated interpolation (minterpolate) — 5-20x slower than fast
  "loop-video": 10,
  "fade-video": 10,
  // Still to Video — one still + one audio → MP4 via local ffmpeg (no
  // provider cost). Deliberately ZERO credits: the free bridge from a still
  // into the video pipeline. The 0-cost reservation path still creates a
  // usage log; the guard still enforces storage/kill-switch/dedup.
  "still-to-video": 0,
  // Slideshow — N stills + one optional audio track → MP4 via local ffmpeg
  // (no provider cost). Zero credits, same rationale and guard behavior as
  // still-to-video.
  "slideshow": 0,
  "transcode-video": 10,
  "audio-isolation": 80,          // alias for elevenlabs-isolation
  "text-to-dialogue": 40,
  "image-to-text": 3,
  "image-to-text:economy": 1,
  "image-to-text:premium": 4,
  "describe-to-picker": 10,
  "describe-to-picker:economy": 10,
  "describe-to-picker:premium": 10,
  "image-critic": 5,
  "image-critic:economy": 10,
  "image-critic:premium": 20,
  "character": 20,
  "object": 20,
  "location": 20,
  "voice-changer": 40,
  "voice-changer-pro": 40,
  "generate-video-pro": 100,       // multi-segment stitch fee-base (flat, on top of per-second segment cost — see ee/billing/generate-video-pro-credits.ts)
  "edit-video-pro": 100,           // replace-span bridge fee-base (flat, on top of per-second ref-rate segment cost — see ee/billing/edit-video-pro-credits.ts)
  "dubbing": 80,
  "voice-remix": 40,
  "voice-design": 50,
  "forced-alignment": 30,
  "social-media-format": 20,
  "social-publish": 10,
  "instagram-post": 10,
  "tiktok-post": 10,
  "youtube-upload": 10,
  "linkedin-post": 10,
  "x-post": 10,
  "facebook-post": 10,
  "telegram-post": 10,
  "publish-social": 10,
  "telegram-channel-feed": 10,
  "save-to-storage": 0,
  "router": 0,
  "component": 0,               // Component node itself is free; inner nodes have their own costs
  // ── Generative Pipeline (Story-to-Video) ──
  // Pipeline orchestration is variable-cost — the upfront estimate is set per run.
  // These are FALLBACK costs the credit-guard uses when an estimate isn't supplied
  // (defensive — the route always supplies one). Number chosen as the median Phase 1A
  // Stage 1-only run (Detection + Showrunner + 2 critics ≈ 30 credits).
  "pipeline-orchestration": 300,
  "pipeline-orchestration:stage_1_only": 300,
  // The editor's GenerativePipelineConfig + node-toolbar call POST
  // /v1/credits/model-costs with the node-type slug ("generative-pipeline")
  // to display the credit estimate. Without an entry here OR a DB row the
  // lookup throws PriceNotConfiguredError → 503. The actual per-run cost
  // is computed by estimateUpfrontCredits (duration × format × mode), so
  // this static row is a UI display fallback only — it's NOT the value
  // charged at run time.
  "generative-pipeline": 300,
  // Phase 2 (granular-pipeline-control): per-call Showrunner refine of a
  // single scene from the ScriptPanel "Regenerate this scene" button.
  // Charged per click — flat 3 credits (1 LLM call, single-SceneSpec emit,
  // actual cost @ Sonnet 4.6 + buffer).
  "regenerate-scene": 30,
  // ── Scene-Context Helpers (Phase 1B.3, §6.11) ──
  // Per-call LLM micro-actions invoked from a SceneNode's context panel.
  // Reserve/refund via backend/src/ee/pipelines/scene-helper-credits.ts.
  // DB source-of-truth: supabase/migrations/130_seed_scene_helper_pricing.sql.
  "scene-helper:audit_prompt": 10,
  "scene-helper:improve_prompt": 20,
  "scene-helper:generate_motion": 10,
  "scene-helper:optimize_for_model": 20,
  "scene-helper:add_broll": 20,
  "scene-helper:bridge_to_next_scene": 20,
  "scene-helper:anchor_scene_style": 20,
  // Phase 1C.1 vision-keyframe helpers — DB row in migration 134.
  // Audit Images: 1 Sonnet vision call per shot (≤8 shots). 3cr covers the
  // amortized average. Validate Match Cut: 1 Sonnet vision call with 2 images.
  // Fix Continuity: 1 Sonnet vision call + (conditional) image regen via
  // pipelineGenerateImage; 4cr covers the critic + 1cr buffer over the cheap
  // image_model regen (e.g. nano-banana). All 3 entries are added together
  // so the credit-pricing-migration-sync REVERSE-direction test stays green
  // (migration 134 seeds all 3 model_pricing rows in one statement).
  "scene-helper:audit_images": 10,
  "scene-helper:fix_continuity": 10,
  "scene-helper:validate_match_cut": 10,
  // Phase 1C.2 Stage 7 sub-steps — DB rows in migration 135.
  // Editor LLM: one Sonnet vision call per pipeline (3cr). Beat-grid extract:
  // pure FFmpeg/aubio post-process, no LLM/provider cost (0cr). Music timeline:
  // 4cr covers the Suno gen wrapper overhead (the Suno cost is reserved
  // separately via the Suno worker). Final merge: 3cr for the FFmpeg combine
  // pass with cut decisions + music overlay. FreeCut export: pure JSON
  // generation, no provider cost (0cr).
  "pipeline-editor-llm": 30,
  "pipeline-beat-grid-extract": 0,
  "pipeline-music-timeline": 40,
  "pipeline-final-merge": 30,
  "pipeline-freecut-export": 0,
  // ── Beeble SwitchX relight — 30-frame-block × resolution reserve holds ──
  // 17 ids: bare (= 240f/1080p worst-case) + 8 block tiers (30/60/90/120/150/
  // 180/210/240, SWITCHX_FRAME_TIERS) × 2 resolutions (720/1080p). ANCHORED to
  // Beeble's published rate 2026-06-26 (developer.beeble.ai/pricing): metered per
  // 30-frame block — 720p f, 1080p f — committed verbatim. BASE
  // (no platform margin): block credits = blockUSD / @720p, 15 @1080p.
  // Tiers are 30-frame multiples so each snaps to the exact block Beeble bills
  // (ceil(frames/30)). Mirrors migration 241 rows (credit-pricing-migration-sync).
  "beeble-switchx": 1200,
  "beeble-switchx:30f:1080p": 150,
  "beeble-switchx:30f:720p": 50,
  "beeble-switchx:60f:1080p": 300,
  "beeble-switchx:60f:720p": 100,
  "beeble-switchx:90f:1080p": 450,
  "beeble-switchx:90f:720p": 150,
  "beeble-switchx:120f:1080p": 600,
  "beeble-switchx:120f:720p": 200,
  "beeble-switchx:150f:1080p": 750,
  "beeble-switchx:150f:720p": 250,
  "beeble-switchx:180f:1080p": 900,
  "beeble-switchx:180f:720p": 300,
  "beeble-switchx:210f:1080p": 1050,
  "beeble-switchx:210f:720p": 350,
  "beeble-switchx:240f:1080p": 1200,
  "beeble-switchx:240f:720p": 400,
}

/**
 * Additive registration hook for private-plugin static credit costs. Called
 * by the private-plugins loader (`backend/src/lib/private-plugins/load.ts`)
 * once per loaded plugin that declares `staticCreditCosts()` — e.g. a future
 * born-private plugin needing a STATIC_CREDIT_COSTS fallback entry the core
 * app doesn't ship with.
 *
 * Merges into STATIC_CREDIT_COSTS WITHOUT overwriting existing keys: a
 * plugin can only ADD pricing for identifiers core doesn't already know
 * about, never override a core-defined (or another plugin's already
 * registered) price. No-op for any key that already exists — idempotent to
 * call more than once with the same map.
 */
export function registerStaticCreditCosts(costs: Record<string, number>): void {
  for (const [identifier, creditCost] of Object.entries(costs)) {
    if (!(identifier in STATIC_CREDIT_COSTS)) {
      STATIC_CREDIT_COSTS[identifier] = creditCost
    }
  }
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
  // Choose Best (reduce): composite key = `reduce:<strategyId>`; the AI judge
  // additionally tiers by its model (strategyConfig.llmModel). Default to
  // `concat` (the cheapest pure-logic strategy) when strategyId is absent.
  // Mirrors reduceCreditIdentifier in routes/reduce.ts so the workflow
  // estimator and the route bill the same id.
  "reduce": (data) => {
    const d = data as { strategyId?: string; strategyConfig?: { llmModel?: unknown } }
    const strategyId = d.strategyId ?? "concat"
    if (strategyId !== "pick-best-llm") return `reduce:${strategyId}`
    const model = typeof d.strategyConfig?.llmModel === "string" ? d.strategyConfig.llmModel : undefined
    return buildLlmCreditIdentifier("reduce:pick-best-llm", model)
  },

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

// Tier order for restriction checks. payg ranks above free and below basic:
// inert while all model_pricing.tier_restriction seeds are null, but keeps an
// admin-set "basic and up" restriction meaning "not for payg" deliberately.
const TIER_ORDER = ["free", "payg", "basic", "standard", "pro", "business"]

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
 * Effective-tier adapter for profile rows. The derivation itself lives in
 * @nodaro/shared (`resolveEffectiveTier`): stored "free" with net lifetime
 * top-ups > 0 derives "payg"; every other stored tier passes through.
 * Entitlement sites call this; billing/provisioning writers use
 * `resolveStoredTier` (payg must never be written anywhere).
 */
function effectiveTierOf(profile: {
  tier?: string | null
  subscription_tier?: string | null
  lifetime_topup_credits: number
}): string {
  return resolveEffectiveTier({
    tier: profile.tier ?? null,
    subscription_tier: profile.subscription_tier ?? null,
    lifetime_topup_credits: profile.lifetime_topup_credits,
  })
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
 * Base costs are cached for 60s. The markup from admin settings is applied on
 * top: finalCost = ceil(baseCost * (1 + markup/100)), where markup is the
 * identifier's per-service margin when one is configured
 * (`service_margin_percent`, longest prefix wins) and the global
 * `cost_markup_percent` otherwise — see ee/billing/service-margin.ts.
 * Both DB values and STATIC_CREDIT_COSTS represent base costs at 0% markup.
 */
export async function getModelCreditCostFromDB(modelIdentifier: string): Promise<ModelPricing> {
  const base = await getModelCreditBaseCost(modelIdentifier)
  // Apply markup from admin settings (cached 60s separately)
  const settings = await getAppSettings()
  const markupPercent = effectiveMarkupPercent(settings, modelIdentifier)
  if (markupPercent > 0 && base.creditCost > 0) {
    return {
      ...base,
      creditCost: Math.ceil(base.creditCost * (1 + markupPercent / 100)),
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
    surface?: { webFreeMode?: boolean; communityInstance?: boolean },
  ): Promise<CreditCheckResult> {
    // Self-hosted: always allow
    if (creditsDisabled()) {
      return { allowed: true, balance: 999999, watermark: false }
    }

    // Get user's profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("tier, subscription_tier, lifetime_topup_credits, subscription_credits, topup_credits, daily_spent_credits, last_daily_reset, app_credits_allowance")
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
    return CreditsService.checkCreditsWithProfile(userId, profile as CreditProfile, modelIdentifier, isAppRun, creditOverride, surface)
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
    surface?: { webFreeMode?: boolean; communityInstance?: boolean },
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

    const userTier = effectiveTierOf(profile)
    // Pool-aware web spending (D1 v2): on consumer surfaces a payg account
    // spends its FREE pool only, under full free-tier semantics — the topup
    // pool is invisible here and stays redeemable via the developer surfaces.
    // Resolved here (not by callers) so the surface flag can be threaded
    // dumbly: for free users the restriction is vacuous, for subscribers it
    // must not apply.
    const webFree = Boolean(surface?.webFreeMode) && userTier === "payg"
    const isFree = userTier === "free" || webFree
    const watermark = isFree && FREE_TIER_RESTRICTIONS.watermark

    // Check tier restriction (from model_pricing table)
    if (pricing.tierRestriction) {
      const userTierIndex = TIER_ORDER.indexOf(webFree ? "free" : userTier)
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

    // Calculate total balance. In web-free mode the topup pool is excluded —
    // it never spends on a consumer surface.
    const subscriptionCredits = profile.subscription_credits ?? 0
    const topupCredits = webFree ? 0 : (profile.topup_credits ?? 0)
    const totalBalance = subscriptionCredits + topupCredits

    // Check if user has enough credits
    if (totalBalance < pricing.creditCost) {
      return {
        allowed: false,
        error: webFree
          ? `Your free credits can't cover this run (need ${pricing.creditCost}, free pool has ${totalBalance}).`
          : `Insufficient credits. Required: ${pricing.creditCost}, Available: ${totalBalance}`,
        balance: totalBalance,
        required: pricing.creditCost,
        subscriptionCredits,
        topupCredits,
        watermark,
        subscriptionRequired: webFree,
      }
    }

    // App run check: free tier users with no topup must have earned enough app
    // allowance. Payg web-free users are exempt — they left the allowance
    // economy at first purchase (mirrors the RPC's v_lifetime gate).
    if (isAppRun && isFree && !webFree && topupCredits === 0) {
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

    // Free tier: daily credit cap (dailyCreditCap null = cap disabled, the
    // state since 2026-08-17 — total exposure is bounded by the one-time
    // 1,500 signup grant). When a cap is set, connected community instances
    // are exempt (founder decision D2: don't interrupt the first evening) —
    // their per-instance monthly cap guards run in the credit guard.
    if (isFree && !surface?.communityInstance) {
      const dailyCap = FREE_TIER_RESTRICTIONS.dailyCreditCap
      if (dailyCap !== null) {
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

      return {
        allowed: true,
        balance: totalBalance,
        required: pricing.creditCost,
        subscriptionCredits,
        topupCredits,
        watermark,
      }
    }

    // Paid tiers: check daily limit from tier_config if configured.
    // Use getEffectiveDailySpent (same as the free branch) so the counter is
    // reset on a new UTC day — reading raw daily_spent_credits would compare
    // today's first request against yesterday's spend and falsely 402-block,
    // even though the authoritative reserve_credits RPC resets it correctly.
    const tierConfig = await getTierConfig(userTier)
    const dailyLimit = surface?.communityInstance
      ? undefined
      : tierConfig.daily_credit_limit ?? undefined
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
    options?: { watermarkOverride?: boolean; isAppRun?: boolean; creditOverride?: number; skipAutoRecharge?: boolean; webFreeMode?: boolean; communityInstance?: boolean },
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
      .select("tier, subscription_tier, lifetime_topup_credits")
      .eq("id", userId)
      .single()
    const userTier = tierProfile
      ? effectiveTierOf(tierProfile as { tier: string | null; subscription_tier: string | null; lifetime_topup_credits: number })
      : "free"
    // Pool-aware web spending (D1 v2): resolved against payg-ness here so the
    // surface flag can be threaded from any web-origin caller unconditionally.
    const webFree = Boolean(options?.webFreeMode) && userTier === "payg"
    const watermark = watermarkOverride !== undefined
      ? watermarkOverride
      : ((userTier === "free" || webFree) && FREE_TIER_RESTRICTIONS.watermark)

    // Daily credit cap, enforced atomically inside reserve_credits (closes the
    // TOCTOU the read-only creditGuard preHandler left open). Free tier uses
    // FREE_TIER_RESTRICTIONS.dailyCreditCap (null since 2026-08-17 = no cap);
    // paid tiers use their configured daily_credit_limit (null = no cap).
    // Web-free payg runs ride the free cap — they ARE free-tier spending.
    const dailyLimit: number | null = options?.communityInstance
      ? null // D2: connected community instances ride uncapped days
      : (userTier === "free" || webFree)
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
    // billing-payer-ok: family 0 — the one line that talks to reserve_credits. P14 threads p_workspace_id here from BillingContext; until then every caller is a personal payer by definition
    const { data: usageLogId, error: reserveError } = await supabase.rpc("reserve_credits", {
      p_user_id: userId,
      p_credits: pricing.creditCost,
      p_job_id: jobId,
      p_model_identifier: modelIdentifier,
      p_provider_cost_usd: providerCostUsd,
      p_display_cost_usd: displayCostUsd,
      p_is_app_run: isAppRun ?? false,
      p_daily_limit: dailyLimit,
      p_web_free_mode: webFree,
    })

    if (reserveError) {
      console.error("[credits] reserve_credits RPC failed:", reserveError.message)
      // A known refusal keeps its identity (anchored prefix survives as a
      // typed error, raw text only in .raw for logs); anything else stays a
      // real fault. String-wrapping here is how prefixes used to die before
      // any catch could match them anchored (P14 review, W3).
      const refusalPrefix = reservePrefixOf(reserveError.message)
      if (refusalPrefix) throw new ReserveRpcError(refusalPrefix, reserveError.message)
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

    // Successful reserve = the only place balances DECREASE — fire the
    // auto-recharge check (best-effort, never blocks). Third-party-app
    // attributed operations are excluded via skipAutoRecharge.
    if (!options?.skipAutoRecharge) {
      void attemptAutoRecharge(userId)
    }
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
    // billing-payer-ok: the RPC reads the payer from the usage_logs row (mig 351) — this wrapper relays the log id; the TS fallback below REFUSES workspace-payer rows (billing-04/H22)
    const { error: rpcError } = await supabase.rpc("commit_credits", {
      p_usage_log_id: usageLogId,
      p_actual_credits: actualCredits,
    })

    if (!rpcError) return

    // Fallback: manual commit. Update the canonical `status` column (the same
    // column the SQL `commit_credits`/`refund_credits` functions use), guarded
    // by status='reserved' so a concurrent commit/refund can't double-fire.
    console.warn("[credits] commit_credits RPC failed, using fallback:", rpcError.message)

    // PAYER-AWARE (billing-04/H22): a workspace-paid row may NOT be settled
    // here — flipping it to committed without moving the workspace budget's
    // reserved → spent would strand the class's headroom with nothing able
    // to reconcile it (refund refuses non-reserved rows). Leave it reserved
    // and loud; a later retry of the RPC is the only correct settlement.
    const { data: payerRow } = await supabase
      .from("usage_logs")
      .select("workspace_id")
      .eq("id", usageLogId)
      .maybeSingle()
    if (payerRow?.workspace_id) {
      console.error(
        `[credits] commit fallback REFUSED for workspace-paid usage log ${usageLogId} — row left reserved for RPC retry`,
      )
      return
    }

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
    // billing-payer-ok: the RPC reads the payer from the usage_logs row (mig 351) — this wrapper relays the log id; the TS fallback below REFUSES workspace-payer rows (billing-04/H22)
    const { error: rpcError } = await supabase.rpc("refund_credits", {
      p_usage_log_id: usageLogId,
    })

    if (!rpcError) return

    // Fallback: manual refund
    console.warn("[credits] refund_credits RPC failed, using fallback:", rpcError.message)

    // Get the usage log to find credits to refund
    const { data: usageLog, error: logError } = await supabase
      .from("usage_logs")
      .select("user_id, job_id, credits_used, status, metadata, workspace_id")
      .eq("id", usageLogId)
      .single()

    if (logError || !usageLog) {
      console.error("[credits] Usage log not found for refund:", usageLogId)
      return
    }

    // PAYER-AWARE (billing-04/H22): a workspace-paid row must NEVER be
    // settled by this fallback. Its metadata carries no from_sub/from_topup
    // by construction, so the zero-split branch below would MINT the class's
    // money into the member's personal topup pool — and flipping the status
    // would strand the workspace's reserved headroom unreconcilably. Leave
    // the row reserved and loud; only the RPC can settle a workspace payer.
    if ((usageLog as { workspace_id?: string | null }).workspace_id) {
      console.error(
        `[credits] refund fallback REFUSED for workspace-paid usage log ${usageLogId} — row left reserved for RPC retry`,
      )
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
      .select("tier, subscription_tier, lifetime_topup_credits, storage_used_bytes, storage_limit_bytes")
      .eq("id", userId)
      .single()

    if (error || !profile) {
      return { allowed: false, error: "User profile not found", usedBytes: 0, limitBytes: 0 }
    }

    return CreditsService.checkStorageLimitWithProfile(profile as unknown as StorageProfile)
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
    const tier = effectiveTierOf(profile)
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
        lifetime_topup_credits,
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
        effectiveTier: "free",
        features: {},
        periodEnd: null,
        appCreditsAllowance: 0,
      }
    }

    // SPLIT deliberately (do not merge back into one variable):
    //  - storedTier gates the subscriptions/Stripe self-heal branch below and
    //    is what gets WRITTEN into subscriptions.tier — "payg" must never
    //    reach that table, and effective-gating would fire pointless Stripe
    //    lookups on every payg balance poll.
    //  - effectiveTier drives entitlement display: tier_config lookup and
    //    the daily-limit branch (payg's row has NULL = uncapped).
    const storedTier = resolveStoredTier({
      tier: profile.tier ?? null,
      subscription_tier: profile.subscription_tier ?? null,
    })
    const effectiveTier = effectiveTierOf(profile)

    // Get tier configuration (cached)
    const tierConfig = await getTierConfig(effectiveTier)

    const subscriptionCredits = profile.subscription_credits ?? 0
    const topupCredits = profile.topup_credits ?? 0

    // For free tier, use FREE_TIER_RESTRICTIONS.dailyCreditCap
    const dailyLimit = effectiveTier === "free"
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
    if (storedTier !== "free") {
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
                    tier: storedTier,
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
      tier: storedTier,
      effectiveTier,
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
      .select("tier, subscription_tier, lifetime_topup_credits, topup_credits, app_credits_allowance")
      .eq("id", userId)
      .single()

    if (!profile) return { allowed: true } // fail open — per-node check will catch

    const userTier = effectiveTierOf(profile as unknown as { tier: string | null; subscription_tier: string | null; lifetime_topup_credits: number })
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

  // LLM Chat uses tiered credit identifier based on selected model. Reasoning
  // effort and advanced mode are passed through too — actual billing bumps a
  // tier on clamped xhigh/max effort and again on advanced mode
  // (buildLlmCreditIdentifier's 3rd and 4th args), so omitting either here
  // would make the pre-run estimate understate the reservation.
  if (nodeType === "llm-chat") {
    const llmModel = data.llmModel as string | undefined
    const reasoningEffort = data.reasoningEffort as string | undefined
    return buildLlmCreditIdentifier("llm-chat", llmModel, reasoningEffort, data.advancedMode === true)
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

  // AI Audit: the credit FAMILY is a GRAPH fact (is an analysis wired into the
  // `analysis` target?), which this node-only resolver cannot see. Quote the
  // pricier `auto` family, mirroring the frontend's no-edge-context default —
  // an estimate may over-quote, it must NEVER under-quote (this feeds published
  // apps' advertised price and the monetization base). The bare `video-audit`
  // key stays at the re-audit ceiling for catalog/DB parity; it is simply never
  // what an estimate quotes.
  if (nodeType === "video-audit") return "video-audit:auto"

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
      resolveVideoAnalysisModel(data.llmModel as string | undefined),
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
