import { usdToCredits, PARAMETER_NODE_TYPES, withWiredSettings, MUSIC_CREDIT_ID, TEXT_TO_AUDIO_SFX_CREDIT_IDS, textToAudioCreditId, CAMERA_SWITCH_CREDIT_ID, LTX_EXTEND_PER_SECOND_CREDIT_ID, ltxExtendDurationSec, LTX_RETAKE_PER_SECOND_CREDIT_ID, ltxRetakeDurationSec, videoSfxCreditId, VIDEO_SFX_PRICING, VIDEO_UTIL_PRICING, applyEdlCreditId, UGC_NODE_TYPES, dialogueProviderOf, EDIT_PLAN_MAX_MINUTES, isRenderNodeType } from "@nodaro/shared"
import { trySettleManagedJob } from "./managed-job-settlement.js"
import {
  generatedVoiceLength,
  knownLength,
  videoOutputLength,
  wireKindOf,
  type InputLength,
  type WireInput,
  type WireLength,
} from "../../lib/video-output-length.js"
import { previewStopsForListing, previewStopsWhenEnabled } from "../../lib/preview-stop-rule.js"
import { inlineEdlMinutes, LENGTH_PRICED_UTILITY_TYPES, nodeFanOut, nodeProviders, renderFinalRunSet, resolveApplyEdlEstimateLength, runWireLengthSec, videoSfxClipSec, resolveApplyEdlEstimateMinutes, resolveEditPlanEpisodeSec, resolveEditPlanEstimateDurationSec, resolveGraphOrigin, mediaLengthSecOf, withoutMediaLength } from "@nodaro/render-rules"
import { editPlanPerMinuteActive } from "../../lib/private-plugins/edit-plan-per-minute.js"
import { supabase } from "../../lib/supabase.js"
import { ReserveRpcError, reservePrefixOf } from "../../lib/reserve-errors.js"
import { refuseBlockedReservation } from "../../lib/access-blocks.js"
import type { FreeGrantState } from "./signup-grant.js"
import { authorizeExternalReservation, deliverExternalWalletSettlements, externalWalletActive } from "./external-wallet.js"
// Track A. `allowanceEnforcementActive()` is the step-8 flip (an active payer
// AND `billing.allowances === "enforce"`); `deploymentPayerActive()` gates the
// settlement-lane cache invalidation so mainline issues no extra read. Both
// answer FALSE on a deployment with no `billing.payerAccount`, which is what
// keeps every branch below inert there.
import { allowanceEnforcementActive, deploymentPayerActive } from "../../lib/deployment-payer.js"
import { attemptAutoRecharge } from "./auto-recharge.js"
import { applyOrgEntitlements, effectiveTierOf, payerProfileId, spendGates } from "./org-entitlements.js"
import { modelAvailabilityRefusal } from "./model-availability.js"
import type { BillingContext } from "../../lib/billing-context.js"
import { hasCredits } from "../../lib/config.js"
import { getAppSettings } from "../../lib/app-settings.js"
import { APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE, APPLY_EDL_PROXY_CREDITS_PER_OUTPUT_MINUTE } from "../../lib/apply-edl-plan.js"
import { AUDIO_SYNC_CREDIT_COSTS, audioSyncCreditId } from "../../lib/audio-sync-credit-id.js"
import { buildSeedanceExtendCreditIdentifier } from "../../lib/seedance-extend-model.js"
import { FREE_TIER_RESTRICTIONS, TIER_STORAGE_LIMITS } from "./stripe-config.js"
import { PIPELINE_PINNABLE_SCRIPT_LLMS, captionRoutesToRemotion, DEFAULT_TRANSCRIBE_NODE_PROVIDER, getLlmTier, buildCreditModelIdentifier, buildVideoCreditModelIdentifier, isSeedanceVideoEditProvider, seedanceVideoEditCreditId, buildMotionCreditModelIdentifier, buildLlmCreditIdentifier, FLUX2_RES_MP, type Flux2Model, AI_AVATAR_DURATION_BUCKETS, resolveAiAvatarCreditId, type AiAvatarEngine, type AiAvatarResolution, CINEMATIC_MIN_DURATION_SEC, CINEMATIC_MAX_DURATION_SEC, cinematicCreditId, resolveCinematicCreditId, type CinematicResolution, resolveSwitchXCreditId, VIDEO_ANALYSIS_DURATION_BUCKETS, VIDEO_ANALYSIS_MAX_DURATION_SEC, VIDEO_ANALYSIS_BUCKET_CREDITS, buildVideoAnalysisCreditId, resolveVideoAnalysisModel, DEFAULT_VIDEO_ANALYSIS_MODEL, VIDEO_AUDIT_BUCKET_CREDITS, buildVideoAuditCreditId, resolveStoredTier, sunoCreditType, resolveTopazUpscale, imageOverlayCredits, renderVideoCreditId, scene3DRenderTierCredits, META_ADS_SCRAPE_CREDIT_COSTS, metaAdsScrapeCreditIdFromNode, INSTAGRAM_SCRAPE_CREDIT_COSTS, instagramScrapeCreditIdFromNode, SOCIAL_SEARCH_CREDIT_COSTS, socialSearchCreditIdFromNode, COMPETITOR_SCAN_CREDIT_COSTS, EDIT_PLAN_MODES, EDIT_PLAN_TIERS, buildEditPlanCreditId, asEditPlanMode, asEditPlanTier, type EditPlanTier, editPlanRateCreditId, editPlanFlatCreditId, editPlanMinutesBaseCredits, parseEditPlanMinutesCreditId, editPlanReserveCreditId, contentRecipeCreditId, contentIdeasCreditId } from "@nodaro/shared"
// Provider-$ cost formulas — CORE lib (not @nodaro/shared, an irrevocably
// published Apache package). See the 2026-07-06 public-flip IP audit, S5.
import { flux2BaseCredits } from "../../lib/pricing/flux2-cost.js"
import { AI_AVATAR_RATE_USD_PER_SEC, aiAvatarHoldCredits } from "../../lib/pricing/ai-avatar-cost.js"
import { applyServiceMarkup } from "./service-margin.js"
import { videoUtilityBaseCredits, videoUtilityEstimateBody } from "../../lib/video-utility-credits.js"
import { speechUnitRowServed } from "../../lib/speech-credits.js"
import { SPEECH_NODE_TYPES, llmScriptChars, speechEstimate, speechEstimateChars, speechScriptTraits, upstreamSpeechText, type ExposedTextCaps } from "../../lib/speech-estimate.js"
import { exposedMediaNodeIds } from "../../lib/exposed-text-caps.js"
import { getWelcomeOfferConfig } from "../lib/welcome-offer-config.js"
import { ConsentRequiredError } from "../lib/consent-required.js"
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

// ── Edit Plan (podcast editing, edit-plan node) — per source minute × tier,
// plus a flat component on `clips` and `trailer` (trailer reuses the clips
// flat, decided 2026-09-23).
// Cloud-EXCLUSIVE + relayed: billing happens on the connected cloud account, so
// these are the DB-down fallback (a seeded model_pricing row wins at runtime).
//
// PRICE ROWS (decided 2026-10-07): ONE rate row and ONE flat row per mode ×
// tier — `edit-plan:<mode>:<tier>:per-minute` and `edit-plan:<mode>:<tier>:flat`
// (migration 484; tighten and chapters have a flat of 0). Every id a run
// reserves, `edit-plan:<mode>:<tier>:<N>m`, costs flat + rate × N from those two
// rows (`editPlanMinutesBase`), whether N is a started-minute count (a plugin
// that declares `supports().editPlanPerMinute`) or one of the old
// 15/30/60/90/120/180-minute steps (an older plugin, and this app's reserve on
// one). No id is stored per minute or per step: migration 484 deletes the 72
// step rows (migrations 432 + 465), whose values were this formula at the step,
// so a retune of the rate or flat row moves the listing, every estimate and
// every reserve together. The id scheme lives in @nodaro/shared and must match
// the plugin's `pricing.ts`.
//
// PRICING STATUS — FINALIZED, value-based launch defaults (admin-retunable in
// /admin/models through the rate and flat rows).
type EditPlanTierT = EditPlanTier
// Finalized launch default (admin-retunable): credits per SOURCE-minute, by tier.
const EDIT_PLAN_CREDITS_PER_MINUTE_BY_TIER: Readonly<Record<EditPlanTierT, number>> = {
  economy: 2,
  standard: 4,
  premium: 8,
}
// Finalized launch default (admin-retunable): flat component added to `clips`
// and `trailer` (the scoring/hook pass over the whole transcript); tighten and
// chapters have no flat term.
const EDIT_PLAN_CLIPS_FLAT_BY_TIER: Readonly<Record<EditPlanTierT, number>> = {
  economy: 10,
  standard: 20,
  premium: 40,
}
/** The modes that carry the flat term: clips, and trailer at the clips flat. */
const EDIT_PLAN_FLAT_MODES: ReadonlySet<string> = new Set(["clips", "trailer"])
const EDIT_PLAN_STATIC: Record<string, number> = {}
for (const mode of EDIT_PLAN_MODES) {
  for (const tier of EDIT_PLAN_TIERS) {
    EDIT_PLAN_STATIC[editPlanRateCreditId(mode, tier)] = EDIT_PLAN_CREDITS_PER_MINUTE_BY_TIER[tier]
    EDIT_PLAN_STATIC[editPlanFlatCreditId(mode, tier)] = EDIT_PLAN_FLAT_MODES.has(mode) ? EDIT_PLAN_CLIPS_FLAT_BY_TIER[tier] : 0
  }
}
// Bare fallback = the MAX any id can cost (= premium clips or trailer at 180
// minutes = 1480): the unknown-mode-AND-unknown-duration id feeds a pre-run
// balance gate, so it must bound every reservable id (mirrors the
// video-analysis bare-id rationale + the plugin).
EDIT_PLAN_STATIC["edit-plan"] = Math.max(
  ...EDIT_PLAN_MODES.flatMap((mode) =>
    EDIT_PLAN_TIERS.map((tier) =>
      editPlanMinutesBaseCredits(
        EDIT_PLAN_STATIC[editPlanFlatCreditId(mode, tier)]!,
        EDIT_PLAN_STATIC[editPlanRateCreditId(mode, tier)]!,
        EDIT_PLAN_MAX_MINUTES,
      ),
    ),
  ),
)

/**
 * The base price of an `edit-plan:<mode>:<tier>:<N>m` id, from its mode/tier's
 * flat and rate rows read through `rowOf` (the caller's own lookup: a single
 * row read, the whole-table price table, or the static table), or `undefined`
 * when `identifier` is not such an id or a row is priced nowhere. ONE formula
 * for every lookup, so the listing, the estimates and the reserve cannot drift.
 */
function editPlanMinutesBase(identifier: string, rowOf: (id: string) => number | undefined): number | undefined {
  const parsed = parseEditPlanMinutesCreditId(identifier)
  if (!parsed) return undefined
  const flat = rowOf(editPlanFlatCreditId(parsed.mode, parsed.tier))
  const rate = rowOf(editPlanRateCreditId(parsed.mode, parsed.tier))
  if (flat === undefined || rate === undefined) return undefined
  return editPlanMinutesBaseCredits(flat, rate, parsed.minutes)
}

// ============================================================
// Types
// ============================================================

/**
 * Spend-surface facts the guard threads into a credit check. `billingContext`
 * (P14) may carry a workspace payer, which swaps the profile-derived gates
 * for the org entitlement grade — see `org-entitlements.ts`, including the
 * scope rule: only a path that actually reserves may thread a context.
 */
export interface CreditCheckSurface {
  webFreeMode?: boolean
  communityInstance?: boolean
  billingContext?: BillingContext
}

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
  /**
   * Free signup grant state. 'withheld' means the account works but the grant
   * did not land — the client shows the activation path. Absent until the
   * gate's column exists (a dev deploy can run ahead of the migration).
   */
  freeGrantState?: FreeGrantState
  /**
   * Welcome-credits opt-in state. PRESENT only while the offer is switched on
   * (app_settings.welcome_offer_enabled) — absent means "no popup, no banner,
   * no block". `popupSeen`: the one-time popup was already shown.
   * `consentPending`: the account was granted through the extension and still
   * owes the email consent — the web apps block creation until it is given.
   */
  welcomeOffer?: { popupSeen: boolean; consentPending: boolean }
  /** Per-user deployment allowance in RAW credits; null when no allowance applies
   *  (no payer, or the caller IS the payer — which holds the real credits, not
   *  an allocation — or the figure was unavailable). NOT null merely because
   *  enforcement is off: the allowance is visible from the moment a payer
   *  exists (the ruling in `deployment-allowance-service.ts`), and refusing a
   *  run is a separate switch. Absent on mainline — `total` is never
   *  overloaded to mean this (D12).
   *
   *  `enforced` IS that separate switch (`allowanceEnforcementActive()`, i.e.
   *  `billing.allowances === "enforce"`). It travels because the browser has no
   *  other way to ask: `billing.allowances` is stripped from /config.js. A
   *  client that GATES a run must consult it — `remaining` is a display figure
   *  until it is true — while a client that only DISPLAYS the allowance ignores
   *  it. */
  allowance?: { granted: number; remaining: number; enforced: boolean } | null
  externalWallet?: { available: number | null }
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

/**
 * The base Remotion render, and the ladder above it.
 *
 * A 3D scene render is priced by FRAME SIZE (`@nodaro/shared`
 * `scene3d-render-pricing`): every frame that fit under the old 1920 px cap
 * keeps this flat price on the bare `render-video` id, and the two composites
 * below only ever describe frames the 2560 px cap newly made renderable. They
 * are DERIVED, never typed twice — repricing the base render moves the whole
 * ladder, which is the property a hand-written pair of numbers loses the first
 * time somebody edits one of them.
 */
const RENDER_VIDEO_BASE_CREDITS = 50

/**
 * ElevenLabs sound effects (Text to Audio) are priced by the length asked
 * for: BASE credits per whole second (the requested length rounded up, 1–30 s;
 * a request with no length is billed as 5 s). One row per second, derived
 * here from the shared id list so a row cannot be typed wrong — the migration
 * that seeds them (457) is value-checked against this table.
 */
const ELEVENLABS_SFX_CREDITS_PER_SECOND = 1
const ELEVENLABS_SFX_PER_SECOND_ROWS: Record<string, number> = Object.fromEntries(
  TEXT_TO_AUDIO_SFX_CREDIT_IDS.map((id, i) => [id, (i + 1) * ELEVENLABS_SFX_CREDITS_PER_SECOND]),
)

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
  // GPT Image 2.5 (Flare + Sunburst) — KIE 6/10/16 cr at 1K/2K/4K.
  "gpt-image-2-5-flare": 15,            // 1K default
  "gpt-image-2-5-flare:2K": 25,
  "gpt-image-2-5-flare:4K": 40,
  "gpt-image-2-5-sunburst": 15,            // 1K default
  "gpt-image-2-5-sunburst:2K": 25,
  "gpt-image-2-5-sunburst:4K": 40,
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
  // ── Edit Plan (podcast editing) — FINALIZED (see the EDIT_PLAN_STATIC
  // block above). The bare `edit-plan` id plus one rate and one flat row per
  // mode × tier (migration 484); every `:<N>m` id is priced from those two
  // rows (`editPlanMinutesBase`), never stored. The DB rows win at runtime.
  ...EDIT_PLAN_STATIC,
  // ── Camera Switch (podcast B5) — FLAT per run (decided 2026-10-03):
  // deterministic code plus a length probe per camera, no model. A clips
  // fan-out runs it once per clip. Written to model_pricing by migration 448.
  [CAMERA_SWITCH_CREDIT_ID]: 10,
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
  // GPT Image 2.5 i2i — same ladder as the t2i siblings.
  "gpt-image-2-5-flare-i2i": 15,             // 1K default
  "gpt-image-2-5-flare-i2i:2K": 25,
  "gpt-image-2-5-flare-i2i:4K": 40,
  "gpt-image-2-5-sunburst-i2i": 15,             // 1K default
  "gpt-image-2-5-sunburst-i2i:2K": 25,
  "gpt-image-2-5-sunburst-i2i:4K": 40,
  "ideogram-edit": 45,            // (BALANCED default)
  "ideogram-edit:TURBO": 30,
  "ideogram-edit:QUALITY": 60,
  "ideogram-remix": 45,           // (BALANCED default)
  "ideogram-remix:TURBO": 30,
  "ideogram-remix:QUALITY": 60,
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
  "veo3:4k": 1300,                // (VEO 3.1 Quality @ 4K — a 1080p generation plus the 4K upscale, so above the flat veo3)
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
  // ── Gemini Omni Flash (KIE google/gemini-omni-flash-1-1) — sibling of
  //    gemini-omni-video: same request shape and the same 4/6/8/10s ladder,
  //    cheaper at every tier. Priced by (resolution band × duration), flat per
  //    generation when a source video is supplied (":vref"). Lowercase 4k.
  //    Nodaro credits = ceil(KIE cr × 2.5 ÷ 10) × 10. ──
  "gemini-omni-flash": 270,        // base = the 8s default render (720p/1080p band)
  "gemini-omni-flash:4":       160,
  "gemini-omni-flash:6":       210,
  "gemini-omni-flash:8":       270,
  "gemini-omni-flash:10":      320,
  "gemini-omni-flash:4k:4":    370,
  "gemini-omni-flash:4k:6":    420,
  "gemini-omni-flash:4k:8":    480,
  "gemini-omni-flash:4k:10":   530,
  "gemini-omni-flash:vref":    420,
  "gemini-omni-flash:4k:vref": 630,
  // ── Wan 3.0 (KIE wan/3-0-video) and Wan 3.0 Prime (wan/3-0-video-prime) ──
  //    True per-second billing at three published resolution rates. Nodaro
  //    credits = ceil(KIE cr/s × duration ÷ 4) × 10 — the same conversion as
  //    happyhorse and minimax-h3 (CREDIT_BASE_USD 0.002 makes 1 KIE credit 2.5
  //    Nodaro credits, rounded up to the next 10). KIE cr/s at 480P/720P/1080P:
  //    wan-3 8 / 16 / 32, wan-3-prime 12.2 / 25.2 / 50.4.
  //    Prime is KIE's HIGH-SPEED tier (faster turnaround, higher rate) — NOT a
  //    quality tier.
  //    ONE ROW PER SECOND across 2-30s rather than a coarse ladder: the tier
  //    lookup snaps UP and falls back to the LAST tier, and commit_credits only
  //    ever refunds a surplus — a coarse ladder would price a 30s render at a
  //    shorter tier permanently.
  //    The bare id is the DEFAULT render (5s @ 720p): the duration falls back to
  //    the global 5s and the resolution to PRICING_DEFAULT_RESOLUTION["wan-3"] =
  //    "720p" (@nodaro/shared), which is what runWan3 sends when the request
  //    omits `resolution`. KIE's own default is 1080P — the provider layer pins
  //    720P so the rendered tier equals the billed tier.
  //    Reference-video runs bill OUTPUT seconds only, so there is no "-ref"
  //    dimension and no computeCredits hook (unlike seedance-2 / minimax-h3).
  "wan-3": 200,                   // (5s 720p default render)
  // 480p — ceil(8 × s ÷ 4) × 10
  "wan-3:2s:480p": 40, "wan-3:3s:480p": 60, "wan-3:4s:480p": 80, "wan-3:5s:480p": 100, "wan-3:6s:480p": 120,
  "wan-3:7s:480p": 140, "wan-3:8s:480p": 160, "wan-3:9s:480p": 180, "wan-3:10s:480p": 200, "wan-3:11s:480p": 220,
  "wan-3:12s:480p": 240, "wan-3:13s:480p": 260, "wan-3:14s:480p": 280, "wan-3:15s:480p": 300, "wan-3:16s:480p": 320,
  "wan-3:17s:480p": 340, "wan-3:18s:480p": 360, "wan-3:19s:480p": 380, "wan-3:20s:480p": 400, "wan-3:21s:480p": 420,
  "wan-3:22s:480p": 440, "wan-3:23s:480p": 460, "wan-3:24s:480p": 480, "wan-3:25s:480p": 500, "wan-3:26s:480p": 520,
  "wan-3:27s:480p": 540, "wan-3:28s:480p": 560, "wan-3:29s:480p": 580, "wan-3:30s:480p": 600,
  // 720p — ceil(16 × s ÷ 4) × 10
  "wan-3:2s:720p": 80, "wan-3:3s:720p": 120, "wan-3:4s:720p": 160, "wan-3:5s:720p": 200, "wan-3:6s:720p": 240,
  "wan-3:7s:720p": 280, "wan-3:8s:720p": 320, "wan-3:9s:720p": 360, "wan-3:10s:720p": 400, "wan-3:11s:720p": 440,
  "wan-3:12s:720p": 480, "wan-3:13s:720p": 520, "wan-3:14s:720p": 560, "wan-3:15s:720p": 600, "wan-3:16s:720p": 640,
  "wan-3:17s:720p": 680, "wan-3:18s:720p": 720, "wan-3:19s:720p": 760, "wan-3:20s:720p": 800, "wan-3:21s:720p": 840,
  "wan-3:22s:720p": 880, "wan-3:23s:720p": 920, "wan-3:24s:720p": 960, "wan-3:25s:720p": 1000, "wan-3:26s:720p": 1040,
  "wan-3:27s:720p": 1080, "wan-3:28s:720p": 1120, "wan-3:29s:720p": 1160, "wan-3:30s:720p": 1200,
  // 1080p — ceil(32 × s ÷ 4) × 10
  "wan-3:2s:1080p": 160, "wan-3:3s:1080p": 240, "wan-3:4s:1080p": 320, "wan-3:5s:1080p": 400, "wan-3:6s:1080p": 480,
  "wan-3:7s:1080p": 560, "wan-3:8s:1080p": 640, "wan-3:9s:1080p": 720, "wan-3:10s:1080p": 800, "wan-3:11s:1080p": 880,
  "wan-3:12s:1080p": 960, "wan-3:13s:1080p": 1040, "wan-3:14s:1080p": 1120, "wan-3:15s:1080p": 1200, "wan-3:16s:1080p": 1280,
  "wan-3:17s:1080p": 1360, "wan-3:18s:1080p": 1440, "wan-3:19s:1080p": 1520, "wan-3:20s:1080p": 1600, "wan-3:21s:1080p": 1680,
  "wan-3:22s:1080p": 1760, "wan-3:23s:1080p": 1840, "wan-3:24s:1080p": 1920, "wan-3:25s:1080p": 2000, "wan-3:26s:1080p": 2080,
  "wan-3:27s:1080p": 2160, "wan-3:28s:1080p": 2240, "wan-3:29s:1080p": 2320, "wan-3:30s:1080p": 2400,
  "wan-3-prime": 320,             // (5s 720p default render)
  // 480p — ceil(12.2 × s ÷ 4) × 10
  "wan-3-prime:2s:480p": 70, "wan-3-prime:3s:480p": 100, "wan-3-prime:4s:480p": 130, "wan-3-prime:5s:480p": 160, "wan-3-prime:6s:480p": 190,
  "wan-3-prime:7s:480p": 220, "wan-3-prime:8s:480p": 250, "wan-3-prime:9s:480p": 280, "wan-3-prime:10s:480p": 310, "wan-3-prime:11s:480p": 340,
  "wan-3-prime:12s:480p": 370, "wan-3-prime:13s:480p": 400, "wan-3-prime:14s:480p": 430, "wan-3-prime:15s:480p": 460, "wan-3-prime:16s:480p": 490,
  "wan-3-prime:17s:480p": 520, "wan-3-prime:18s:480p": 550, "wan-3-prime:19s:480p": 580, "wan-3-prime:20s:480p": 610, "wan-3-prime:21s:480p": 650,
  "wan-3-prime:22s:480p": 680, "wan-3-prime:23s:480p": 710, "wan-3-prime:24s:480p": 740, "wan-3-prime:25s:480p": 770, "wan-3-prime:26s:480p": 800,
  "wan-3-prime:27s:480p": 830, "wan-3-prime:28s:480p": 860, "wan-3-prime:29s:480p": 890, "wan-3-prime:30s:480p": 920,
  // 720p — ceil(25.2 × s ÷ 4) × 10
  "wan-3-prime:2s:720p": 130, "wan-3-prime:3s:720p": 190, "wan-3-prime:4s:720p": 260, "wan-3-prime:5s:720p": 320, "wan-3-prime:6s:720p": 380,
  "wan-3-prime:7s:720p": 450, "wan-3-prime:8s:720p": 510, "wan-3-prime:9s:720p": 570, "wan-3-prime:10s:720p": 630, "wan-3-prime:11s:720p": 700,
  "wan-3-prime:12s:720p": 760, "wan-3-prime:13s:720p": 820, "wan-3-prime:14s:720p": 890, "wan-3-prime:15s:720p": 950, "wan-3-prime:16s:720p": 1010,
  "wan-3-prime:17s:720p": 1080, "wan-3-prime:18s:720p": 1140, "wan-3-prime:19s:720p": 1200, "wan-3-prime:20s:720p": 1260, "wan-3-prime:21s:720p": 1330,
  "wan-3-prime:22s:720p": 1390, "wan-3-prime:23s:720p": 1450, "wan-3-prime:24s:720p": 1520, "wan-3-prime:25s:720p": 1580, "wan-3-prime:26s:720p": 1640,
  "wan-3-prime:27s:720p": 1710, "wan-3-prime:28s:720p": 1770, "wan-3-prime:29s:720p": 1830, "wan-3-prime:30s:720p": 1890,
  // 1080p — ceil(50.4 × s ÷ 4) × 10
  "wan-3-prime:2s:1080p": 260, "wan-3-prime:3s:1080p": 380, "wan-3-prime:4s:1080p": 510, "wan-3-prime:5s:1080p": 630, "wan-3-prime:6s:1080p": 760,
  "wan-3-prime:7s:1080p": 890, "wan-3-prime:8s:1080p": 1010, "wan-3-prime:9s:1080p": 1140, "wan-3-prime:10s:1080p": 1260, "wan-3-prime:11s:1080p": 1390,
  "wan-3-prime:12s:1080p": 1520, "wan-3-prime:13s:1080p": 1640, "wan-3-prime:14s:1080p": 1770, "wan-3-prime:15s:1080p": 1890, "wan-3-prime:16s:1080p": 2020,
  "wan-3-prime:17s:1080p": 2150, "wan-3-prime:18s:1080p": 2270, "wan-3-prime:19s:1080p": 2400, "wan-3-prime:20s:1080p": 2520, "wan-3-prime:21s:1080p": 2650,
  "wan-3-prime:22s:1080p": 2780, "wan-3-prime:23s:1080p": 2900, "wan-3-prime:24s:1080p": 3030, "wan-3-prime:25s:1080p": 3150, "wan-3-prime:26s:1080p": 3280,
  "wan-3-prime:27s:1080p": 3410, "wan-3-prime:28s:1080p": 3530, "wan-3-prime:29s:1080p": 3660, "wan-3-prime:30s:1080p": 3780,
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
  // Nodaro rates: 20 cr/sec Standard, 40 cr/sec Pro (matches pre-upgrade ~14s flat).
  // Bare keys remain for back-compat — callers without audioDurationSec hit them.
  "kling-avatar": 280,             // legacy default ~14s
  "kling-avatar:15s": 300,         // 15s × 20 cr/sec
  "kling-avatar:30s": 600,         // 30s × 20 cr/sec
  "kling-avatar:60s": 1200,        // 60s × 20 cr/sec
  "kling-avatar:120s": 2400,       // 120s × 20 cr/sec
  "kling-avatar:300s": 6000,       // 300s × 20 cr/sec — 5-min ceiling
  "kling-avatar-pro": 560,         // legacy default ~14s
  "kling-avatar-pro:15s": 600,     // 15s × 40 cr/sec
  "kling-avatar-pro:30s": 1200,    // 30s × 40 cr/sec
  "kling-avatar-pro:60s": 2400,    // 60s × 40 cr/sec
  "kling-avatar-pro:120s": 4800,   // 120s × 40 cr/sec
  "kling-avatar-pro:300s": 12000,  // 300s × 40 cr/sec — 5-min ceiling
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
  // = 20 cr/sec. lip-sync sets no meteredCost, so
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
  "elevenlabs-v3": 30,             // direct ElevenLabs API — flat per request; the price with length pricing off
  "elevenlabs-v4": 30,             // same flat price as v3 (parity, decided 2026-10-05)
  "elevenlabs-turbo": 15,         // flat per request (NOT per 1K chars — that scaling never existed)
  "elevenlabs-multilingual": 30,  // flat per request (NOT per 1K chars)
  "elevenlabs": 15,               // alias for turbo
  // Length-based speech pricing (decided 2026-10-06): the price of ONE started
  // 100 characters, read by lib/speech-credits.ts while
  // SPEECH_LENGTH_PRICING_ENABLED is on; a request is at least
  // SPEECH_FLOOR_UNITS (8) units. The flat rows above stay as they are: they
  // are what a run costs with the flag off and what every client that knows
  // nothing of length pricing shows. Values are re-derived from
  // lib/pricing/elevenlabs-speech-cost.ts by speech-unit-pricing.test.ts —
  // never hand-edited alone. The legacy `elevenlabs` alias has no row: it
  // prices on turbo's (speechUnitCreditId).
  "elevenlabs-v3:per-100-chars": 4,
  "elevenlabs-v4:per-100-chars": 4,
  "elevenlabs-turbo:per-100-chars": 2,
  "elevenlabs-multilingual:per-100-chars": 4,
  // Sound effects are priced by the length asked for: one row per whole second
  // (`elevenlabs-sfx:1s` … `:30s`, ELEVENLABS_SFX_PER_SECOND_ROWS below), picked
  // by `textToAudioCreditId` on every path. The bare row is the no-duration
  // default (billed as 5 s) for any caller that still names the engine alone.
  "elevenlabs-sfx": 5 * ELEVENLABS_SFX_CREDITS_PER_SECOND,
  ...ELEVENLABS_SFX_PER_SECOND_ROWS,
  // Replicate disabled
  // "tangoflux": 4, // Replicate SFX, estimated
  "suno": 30,                     // (V4) — base
  "suno-v5": 30,                  // (V5)
  "suno-v5_5": 30,                // (V5.5)
  "suno-v6": 30,                  // (V6 — the default; 12 KIE credits, same as every prior version)
  "suno-v6_wild": 30,             // (V6 Wild)
  "suno-v6_mini": 30,             // (V6 Mini)
  "suno-generate": 30,            // (fallback key for a version with no row in SUNO_VERSION_CREDIT_KEYS)
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
  // Both Replicate transcription lanes are LIVE again — the canvas Transcribe
  // node has offered them since #768 and /v1/transcribe accepts all three
  // engines, so a commented-out row here is a 503 price_not_configured on a
  // legal request. Values read from the production model_pricing rows
  // (2026-09-21); migration 288 seeded 40 and the table was tuned up from there.
  "whisper": 40,                  // Replicate openai/whisper — no word timings (BASE price, = migration 288; the service markup is applied on top at read time)
  "incredibly-fast-whisper": 40,  // Replicate fast whisper — word timings on request (BASE price, = migration 288)
  "elevenlabs-stt": 22,           // avg (from audit)
  "elevenlabs-dialogue": 25,     // direct ElevenLabs API; flat per request, whatever the length (the price with length pricing off)
  "elevenlabs-dialogue:per-100-chars": 4, // one started 100 characters across lines (decided 2026-10-06)
  "elevenlabs-dialogue-v4": 25,  // direct ElevenLabs API; the same flat price as v3 dialogue, per request
  "elevenlabs-dialogue-v4:per-100-chars": 4, // as v3 dialogue: one started 100 characters across lines (decided 2026-10-06)
  "elevenlabs-voice-changer": 40,  // ElevenLabs speech-to-speech
  // ElevenLabs dubbing (async) — PER MINUTE of the dubbed span (route
  // computeCredits: ceil(seconds/60) x this base, min 1 minute; 120s
  // fallback bucket when un-probeable). Was flat 80; 40/min prices the
  // typical ~2-min clip identically. The model_pricing row is the same
  // per-minute base (migration 359).
  "elevenlabs-dubbing": 40,
  "elevenlabs-dubbing-v2": usdToCredits(2.2),
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
  "render-video": RENDER_VIDEO_BASE_CREDITS,            // Remotion compute
  // 3D scene renders past 1920 px on the longest side — 1.5x for a
  // 2560x1440-class frame, 2.5x for a square 2560x2560 one.
  "render-video:3d-large": scene3DRenderTierCredits(RENDER_VIDEO_BASE_CREDITS, "large"),
  "render-video:3d-xlarge": scene3DRenderTierCredits(RENDER_VIDEO_BASE_CREDITS, "xlarge"),
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
  // Scene3D previz authoring (generate-3d-scene / edit-3d-scene). Priced on
  // scene-graph-ai's ladder — the closest analogue: one structured scene
  // description in, one structured scene graph out.
  "3d-scene": 30,                // standard
  "3d-scene:economy": 10,
  "3d-scene:premium": 40,
  // The DETERMINISTIC edit lane: the caller sent `operations`, they are applied
  // by `applyScene3DEditOperations` in-process and no model is ever called. It
  // still gets an identifier (and a job row) so the wire contract, the job
  // history and the refund machinery are identical on both lanes — the price is
  // just zero. Spelled with a hyphen, not `3d-scene:ops`, so it can never be
  // mistaken for a tier suffix that `buildLlmCreditIdentifier` produces.
  "3d-scene-ops": 0,
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
  // ── Site Capture (POST /v1/site-capture, MCP capture_site): flat per capture ──
  "site-capture": 10,
  // Meta Ads scraper: 1 credit per REQUESTED ad, rounded up to a tier of
  // count × sources, plus the optional per-ad analysis multiples and their
  // per-ad settlement rows (packages/shared/src/meta-ads-scrape.ts is the
  // formula AND the table — one source for this fallback, the frontend
  // badge and the docs; the bare id is the pre-Zod guard fallback).
  // Migrations 428 + 429.
  ...META_ADS_SCRAPE_CREDIT_COSTS,
  // Instagram scraper: 1 credit per requested post, tiered on count × sources,
  // + the same analysis multiples (packages/shared is the table). Migration 433.
  ...INSTAGRAM_SCRAPE_CREDIT_COSTS,
  // Social Search: per page of up to 20 results (20 / 40 / 60 posts), the same
  // on every platform. Cloud-only — a private plugin runs the search; these
  // are the public prices it is billed at (packages/shared social-search.ts is
  // the table).
  ...SOCIAL_SEARCH_CREDIT_COSTS,
  // Competitor scan: one Social Search page per search the scan runs
  // (competitor-scan:<n> = n pages). Cloud-only, like Social Search
  // (packages/shared competitors.ts is the table). Migration 447.
  ...COMPETITOR_SCAN_CREDIT_COSTS,
  "qa-check": 20,
  "qa-check:economy": 10,
  "qa-check:premium": 40,
  // ── Video utilities priced per unit (Trim / Loop / Combine / Assemble
  //    Narrated Video). A run is charged units × VIDEO_UTIL_PRICING.CREDIT_UNIT
  //    (@nodaro/shared) on both paths — the route's computeCredits and the
  //    workflow run's override, one mapping in lib/video-utility-credits.ts.
  //    Each row is ONE unit and mirrors that constant, so an estimate can quote
  //    the row × units (pinned by video-utility-credits.test.ts).
  "combine-videos": 10,
  // apply-edl — render an EDL into ONE media file (local ffmpeg, no provider
  // cost). Priced PER MINUTE of rendered output: the route's computeCredits and
  // the DAG's applyEdlCreditOverride both reserve `this × ceil(edlDurationMs/
  // 60000)`. The bare row here is the estimator fallback (1-minute floor).
  // Value is the single source of truth `APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE`
  // (lib/apply-edl-plan.ts); the model_pricing row (migration 431) mirrors it.
  // Decided 2026-10-04: the final stays at 10.
  // One row per render QUALITY, for a video and an audio output alike: every
  // site takes the id from `applyEdlCreditId(quality)` (@nodaro/shared).
  "apply-edl": APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE,
  // The preview (`quality: "proxy"`) — its own, lower per-minute rate,
  // decided 2026-10-05. Value is `APPLY_EDL_PROXY_CREDITS_PER_OUTPUT_MINUTE`
  // (lib/apply-edl-plan.ts); migration 454 seeded the row, 455 reprices it. The proxy < final guard
  // reads these code values, not the admin rows, so the two model_pricing rows
  // are retuned together (the node docs say so).
  "apply-edl:proxy": APPLY_EDL_PROXY_CREDITS_PER_OUTPUT_MINUTE,
  // Image Collage — composites N images into one 2K/4K image (local ffmpeg,
  // no provider cost). Priced by resolution. Base + resolution composites;
  // the single-node route uses computeCredits, workflow runs reserve the
  // composite via the payload-builder modelIdentifier. See migration 244.
  "image-collage": 20,
  "image-collage:2K": 20,
  "image-collage:4K": 40,
  // Image Overlay — places up to 12 image layers (logo, badge, cut-out) on a
  // base image with sharp (local compute, no provider cost). Flat: a banner
  // and a 4K poster cost the same to composite. See migration 394.
  // Base only — the route / orchestrator / canvas add IMAGE_OVERLAY_VARIANT_CREDITS
  // per extra platform render via imageOverlayCredits (@nodaro/shared).
  "image-overlay": 10,
  // Assemble Narrated Video — fits N ordered (clip, voice) blocks into one
  // MP4 via ffmpeg (local compute, no external provider cost). ONE unit (see
  // the video-utility rows above): a run is 3 units + 1 per 6 blocks
  // (assembleNarratedVideoCredits), on the route and the workflow run alike.
  "assemble-narrated-video": 10,
  "merge-video-audio": 20,
  "add-captions": 30,
  "add-captions:kinetic": 50,
  "resize-video": 20,
  "trim-audio": 10,
  // Silence Detect — one local ffmpeg `silencedetect` pass over the audio
  // proxy, no external provider. Flat 10cr, the scale of its local-ffmpeg
  // siblings (seeded at 1 by migration 430 — a ×10 re-denomination slip,
  // corrected by migration 439). Keyless; community works.
  "silence-detect": 10,
  // Audio Sync — measures 2–6 recordings' clock offsets (local ffmpeg decode +
  // in-process cross-correlation, no provider). Priced PER SOURCE ALIGNED to
  // the reference: `audio-sync:<n>src` = 10 × (n − 1) — 2 sources 10 … 6
  // sources 50 (decided 2026-09-25). Composites only (no bare row): every lane
  // names a composite through `audioSyncCreditId` (lib/audio-sync-credit-id.ts),
  // the single source of these rows; migration 443 mirrors them. Keyless.
  ...AUDIO_SYNC_CREDIT_COSTS,
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
  // Video Overlay — timed image layers over a video in one local FFmpeg pass
  // (no provider cost). Flat per run, whatever the layer count or length.
  "video-overlay": 20,
  // Still to Video — one still + one audio → MP4 via local ffmpeg (no
  // provider cost). Deliberately ZERO credits: the free bridge from a still
  // into the video pipeline. The 0-cost reservation path still creates a
  // usage log; the guard still enforces storage/kill-switch/dedup.
  "still-to-video": 0,
  // GIF to Video — animated GIF → H.264 MP4 via local ffmpeg (no provider
  // cost). Zero credits, same rationale as still-to-video: a free bridge that
  // lets a GIF be used as a motion reference for models that reject GIF input.
  "gif-to-video": 0,
  // Slideshow — N stills + one optional audio track → MP4 via local ffmpeg
  // (no provider cost). Zero credits, same rationale and guard behavior as
  // still-to-video.
  "slideshow": 0,
  "transcode-video": 10,
  "audio-isolation": 80,          // alias for elevenlabs-isolation
  // node-type fallback — reachable only when the dialogue model's own row is unpriced; equals the default dialogue model's flat row
  "text-to-dialogue": 25,
  "image-to-text": 3,
  "image-to-text:economy": 1,
  "image-to-text:premium": 4,
  "describe-to-picker": 10,
  "describe-to-picker:economy": 10,
  "describe-to-picker:premium": 10,
  // POST /v1/llm/structured — its own feature id, not llm-chat's: a rendered
  // catalog legend as the system prompt is several times a chat turn. Flat per
  // tier at describe-to-picker parity (migration 358).
  // owner-tunable; confirm at PR review.
  "llm-structured": 10,
  "llm-structured:economy": 10,
  "llm-structured:premium": 10,
  "image-critic": 20,
  "image-critic:economy": 10,
  "image-critic:premium": 40,
  // Content Recipe — one structured call over one post, flat per call by the
  // model's tier (owner decision 2026-10-01). Cloud-only: the private plugin
  // runs it; these are the public prices it is billed at.
  "content-recipe:economy": 5,
  "content-recipe": 20,
  "content-recipe:premium": 35,
  // UGC Script (Cloud only): one flat price per run, however many rewrites it takes; refunded when it fails.
  "ugc-script": 20,
  // UGC Clip (Cloud only): admitted with a computed ceiling (creditOverride) that replaces this row; the
  // row exists only so the price read before the override never throws. Never charged, never shown
  // (the estimate prices UGC through the plugin seam).
  "ugc-clip": 0,
  // UGC Creator / UGC Clips / UGC Cards (Cloud only): free nodes. Their paid steps run as their own jobs
  // (images, readings, clips, alignment), each priced under its own row. These 0 rows match the editor's
  // cold-cache fallbacks (NODE_CREDIT_COSTS, frontend-credit-fallback-parity.test.ts), as sub-workflow's does.
  "ugc-creator": 0,
  "ugc-clips": 0,
  "ugc-cards": 0,
  // Content Ideas — charged per batch of up to five ideas (owner decision
  // 2026-10-02): 1–5 ideas bill the base id, 6–10 the `:10` id at two batches.
  // The count rule lives in @nodaro/shared content-recipe-ideas.ts.
  "content-ideas:economy": 10,
  "content-ideas": 35,
  "content-ideas:premium": 50,
  "content-ideas:10:economy": 20,
  "content-ideas:10": 70,
  "content-ideas:10:premium": 100,
  "character": 20,
  "object": 20,
  "location": 20,
  "voice-changer": 40,
  // Per MINUTE of stem audio per speech-to-speech slot, prorated per second (the plugin
  // route/handler read this unit through ee/billing/voice-changer-pro-credits.ts;
  // its siblings -analyze/-export/-respeak are seeded by the plugin and rowed
  // by migration 427).
  "voice-changer-pro": 40,
  // The plugin's own seeds (staticCreditCosts(), registered over these on
  // load) — repeated here at the same values so migration 427's rows are not
  // ghosts and ee/billing/voice-changer-pro-credits.ts prices without the
  // plugin loaded (tests, previews). Keep the four pairs equal.
  "voice-changer-pro-analyze": 10,   // flat: one separation + one diarization
  "voice-changer-pro-export": 1,     // flat: a stream-copy remux
  "voice-changer-pro-respeak": 30,   // per started 1K re-spoken chars (elevenlabs-v3 parity)
  // The FLOOR of the metered translate step ("Re-speak in another language"):
  // the step reserves a per-tier ceiling from its source characters and
  // commits the translation model's measured usage, never below this row.
  // The per-tier ceilings live in ee/billing/voice-changer-pro-credits.ts.
  "voice-changer-pro-translate": 2,
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
  // Telegram Reply — one message to the run's owner, flat (owner decision
  // 2026-10-02). Cloud-only: the private plugin sends it.
  "telegram-account-send": 10,
  "telegram-channel-feed": 10,
  // Collections (migration 462 / pricing rows 463): free — the plan's caps, not credits, bound them.
  "collection-write": 0,
  "collection-read": 0,
  // Read Inspiration / Read Competitor (pricing rows 485): free — they read what the account already holds.
  "inspiration-read": 0,
  "competitor-read": 0,
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

  // Render Video: a 3D scene render is priced by FRAME SIZE, so the id depends
  // on the plan the node carries. Same `renderVideoCreditId` the route guard
  // and the orchestrator's payload builder call, so an estimate and the charge
  // can only ever name the same row. A node whose plan arrives from an
  // upstream composer has none in `data` and resolves to the flat id — the
  // honest answer for an estimate, and never the charge (the route re-resolves
  // from the request body it is actually about to run).
  "render-video": (data) => renderVideoCreditId(data),

  // Audio Sync: `audio-sync:<n>src` from a request-shaped record's `sources`
  // array (the route body / the job's input_data) — the same builder the route
  // guard, its reservation and the payload builder use. No array → the
  // 6-source ceiling (never under-quote).
  "audio-sync": (data) => audioSyncCreditId(Array.isArray(data.sources) ? data.sources.length : Number.NaN),

  // Camera Switch: flat — one id whatever the request carries.
  "camera-switch": () => CAMERA_SWITCH_CREDIT_ID,
}

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
  pricingRowsCache.invalidate()
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

  // Edit Plan `:<N>m` ids are priced from their mode/tier's flat and rate rows
  // (decided 2026-10-07), never a row of their own. The rate row carries the
  // switch an admin flips (enabled, tier restriction).
  const minutes = parseEditPlanMinutesCreditId(modelIdentifier)
  if (minutes) {
    const rate = await getModelCreditBaseCost(editPlanRateCreditId(minutes.mode, minutes.tier))
    const flat = await getModelCreditBaseCost(editPlanFlatCreditId(minutes.mode, minutes.tier))
    const priced: ModelPricing = { ...rate, creditCost: editPlanMinutesBaseCredits(flat.creditCost, rate.creditCost, minutes.minutes) }
    modelPricingCache.set(modelIdentifier, priced)
    return priced
  }

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
 * top via `applyServiceMarkup` (integer-domain ceil, see service-margin.ts),
 * where markup is the identifier's per-service margin when one is configured
 * (`service_margin_percent`, longest prefix wins) and the global
 * `cost_markup_percent` otherwise — see ee/billing/service-margin.ts.
 * Both DB values and STATIC_CREDIT_COSTS represent base costs at 0% markup.
 */
export async function getModelCreditCostFromDB(modelIdentifier: string): Promise<ModelPricing> {
  const base = await getModelCreditBaseCost(modelIdentifier)
  // Apply markup from admin settings (cached 60s separately)
  const settings = await getAppSettings()
  const creditCost = applyServiceMarkup(base.creditCost, settings, modelIdentifier)
  return creditCost === base.creditCost ? base : { ...base, creditCost }
}

// ── Charged price table (60s TTL) ──

/**
 * Every price at once, for the surfaces that list many: `GET /v1/models`, MCP
 * `list_models`, `GET /v1/nodes` and the workflow estimates.
 *
 * The batch twin of `getModelCreditCostFromDB`, and it has to stay that: a
 * listed price that differs from the Run button is the bug this exists to fix
 * (listed 150, charged 165). Same rule, so a price reads the same on every
 * surface: a `model_pricing` row wins, `STATIC_CREDIT_COSTS` is the fallback,
 * and `applyServiceMarkup` marks the base up ONCE for its identifier.
 */
export interface ChargedPriceTable {
  /** The base credits for `identifier`: its `model_pricing` row, else its
   *  `STATIC_CREDIT_COSTS` entry, else undefined (priced nowhere). */
  base(identifier: string): number | undefined
  /** `baseCredits` marked up once for `identifier`, exactly as a reservation
   *  is: `creditGuard` marks a computed total (Image Overlay's per-platform
   *  price, a per-second rate × seconds) up once at the route's identifier. */
  charge(identifier: string, baseCredits: number): number
  /** Whether an Edit Plan run is charged per started minute here (the loaded
   *  plugin's `supports().editPlanPerMinute`, decided 2026-10-07): an estimate
   *  then quotes `edit-plan:<mode>:<tier>:<N>m` for the source's N started
   *  minutes, else the step its length rounds up to. Absent = steps. */
  readonly editPlanPerMinute?: boolean
}

/**
 * The price a user pays for `units` of `identifier` (1 by default), or
 * undefined when it is priced nowhere. Units multiply the base BEFORE the
 * markup, as a route that computes its price reserves it (a per-second rate ×
 * seconds, rounded up to a whole credit, marked up once). Units may be
 * fractional — a retake window is set to the frame.
 */
export function chargedCredits(prices: ChargedPriceTable, identifier: string, units = 1): number | undefined {
  const base = prices.base(identifier)
  return base === undefined ? undefined : prices.charge(identifier, Math.ceil(base * units))
}

/**
 * `model_pricing` read whole. A page is the next rows after the last one read,
 * never a fixed offset: PostgREST caps a response at the project's `max_rows`
 * (1000 by default, lower if configured) WITHOUT an error, so fixed-size pages
 * would silently skip everything past the cap on each page.
 */
async function readModelPricingRows(): Promise<ReadonlyMap<string, number> | null> {
  const rows = new Map<string, number>()
  for (let from = 0; ; ) {
    const { data, error } = await supabase
      .from("model_pricing")
      .select("model_identifier, credit_cost")
      .order("model_identifier", { ascending: true })
      .range(from, from + 999)
    if (error) {
      console.error("[credits] Failed to read model_pricing for the price table:", error.message)
      return null
    }
    const page = (data ?? []) as Array<{ model_identifier: string; credit_cost: unknown }>
    for (const row of page) {
      if (typeof row.credit_cost === "number") rows.set(row.model_identifier, row.credit_cost)
    }
    if (page.length === 0) return rows
    from += page.length
  }
}

const pricingRowsCache = new TtlCache<ReadonlyMap<string, number>>(60_000)
let pricingRowsInflight: Promise<ReadonlyMap<string, number> | null> | null = null

async function modelPricingRows(): Promise<ReadonlyMap<string, number>> {
  const cached = pricingRowsCache.get("all")
  if (cached) return cached
  pricingRowsInflight ??= readModelPricingRows().finally(() => {
    pricingRowsInflight = null
  })
  const rows = await pricingRowsInflight
  // A failed read prices from STATIC_CREDIT_COSTS alone, as a failed single
  // lookup does, but is not cached: the next request reads the table again.
  if (!rows) return new Map()
  pricingRowsCache.set("all", rows)
  return rows
}

export async function getChargedPriceTable(): Promise<ChargedPriceTable> {
  const [rows, settings, editPlanPerMinute] = await Promise.all([modelPricingRows(), getAppSettings(), editPlanPerMinuteActive()])
  return {
    editPlanPerMinute,
    // A speech `:per-100-chars` row is served only while length pricing is on
    // (lib/speech-credits.ts): its absence is how a client learns the flag.
    base: (identifier) => {
      if (!speechUnitRowServed(identifier)) return undefined
      const rowOf = (id: string) => rows.get(id) ?? STATIC_CREDIT_COSTS[id]
      return editPlanMinutesBase(identifier, rowOf) ?? rowOf(identifier)
    },
    charge: (identifier, baseCredits) => applyServiceMarkup(baseCredits, settings, identifier),
  }
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
// Track A — settlement-time balance invalidation (D12 rider)
// ============================================================

/**
 * The requester a settlement should invalidate, or null.
 *
 * `commitCredits` / `refundCredits` are handed a usage-log id and nothing
 * else, so the person whose allowance is moving has to be read back off the
 * row. Two properties matter:
 *
 *  - MAINLINE ISSUES NO QUERY. `deploymentPayerActive()` is false on every
 *    deployment with no `billing.payerAccount`, and this returns null before
 *    touching the database — settlement stays exactly the shape it has today.
 *  - IT NEVER THROWS. A cache invalidation must not be able to stop money
 *    from settling, so a failed read degrades to "invalidate nothing" (the
 *    balance is then up to 15 s stale, a display lag) rather than to an
 *    unsettled reservation.
 *
 * `on_behalf_of` is NULL on the payer's own runs, which need no invalidation
 * here: the payer's balance is the real pool and is invalidated by the routes
 * that move it.
 */
async function settlementRequester(usageLogId: string): Promise<string | null> {
  if (!deploymentPayerActive()) return null
  try {
    const { data } = await supabase
      .from("usage_logs")
      .select("on_behalf_of")
      .eq("id", usageLogId)
      .maybeSingle()
    return ((data as { on_behalf_of?: string | null } | null)?.on_behalf_of) ?? null
  } catch {
    return null
  }
}

/**
 * True when this `usage_logs` row's reservation is ALSO held in the deployment
 * allowance ledger, so only the SQL functions can settle it.
 *
 * The pair is exactly what migration 382 branches on (382:689 for commit,
 * 382:855 for refund): `metadata.payer.allowance_enforced` STAMPED AT RESERVE
 * TIME, and a non-null `on_behalf_of`. Both halves are load-bearing:
 *
 *  - The flag, not `on_behalf_of` alone (D4). A row reserved BEFORE the
 *    `billing.allowances` flip carries attribution but never bumped a ledger;
 *    refusing to settle it would strand an ordinary row for no reason.
 *  - `on_behalf_of`, not the flag alone: the ledger is keyed on it, and the
 *    payer's own runs carry neither.
 */
function holdsEnforcedAllowance(row: { metadata?: unknown; on_behalf_of?: string | null } | null): boolean {
  if (!row) return false
  const payer = (row.metadata as { payer?: { allowance_enforced?: unknown } } | null)?.payer
  return payer?.allowance_enforced === true && row.on_behalf_of != null
}

/**
 * Drop a requester's cached balance. Reached through `await import` because a
 * static `ee/billing -> ee/routes` edge closes a cycle (`routes/credits.ts`
 * imports this module); `signup-grant.ts:51` is the precedent. A null
 * requester — every mainline call — does nothing and imports nothing.
 */
async function invalidateRequesterBalance(requester: string | null): Promise<void> {
  if (!requester) return
  try {
    const { invalidateBalanceCache } = await import("../routes/credits.js")
    invalidateBalanceCache(requester)
  } catch (err) {
    console.warn(`[credits] balance-cache invalidation failed for ${requester}:`, (err as Error).message)
  }
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
    /** `"org"` = a workspace-paid row (P14): the money moved in the workspace
     *  budget, never the personal pools. The personal-history views filter
     *  these out; the org reporting joins on them (P15). */
    creditType: "subscription" | "topup" | "org"
    source: "subscription_created" | "subscription_renewal" | "one_time_purchase" | "admin_adjustment" | "usage" | "org_usage" | "refund" | "stripe_refund" | "expiry" | "signup_grant"
    description?: string
    jobId?: string
    stripeTransactionId?: string
    adminUserId?: string
    balanceAfter: number
    /** Set together on workspace-paid rows only (migration 351 columns). */
    workspaceId?: string
    orgId?: string
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
          // Conditional so every existing personal caller's insert shape is
          // byte-identical (and never trips 42703 on a DB before 351).
          ...(params.workspaceId ? { workspace_id: params.workspaceId } : {}),
          ...(params.orgId ? { org_id: params.orgId } : {}),
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
    surface?: CreditCheckSurface,
  ): Promise<CreditCheckResult> {
    // Self-hosted: always allow
    if (creditsDisabled()) {
      return { allowed: true, balance: 999999, watermark: false }
    }

    // Check the same account reserveCredits will debit. Workflow preflights
    // carry the resolved deployment context but do not pass through the route
    // guard, which already loads the payer's profile. The requester still owns
    // the job and remains the identity passed to the shared credit check.
    const profileUserId = payerProfileId(userId, surface?.billingContext)
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("tier, subscription_tier, lifetime_topup_credits, subscription_credits, topup_credits, daily_spent_credits, last_daily_reset, app_credits_allowance")
      .eq("id", profileUserId)
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
    surface?: CreditCheckSurface,
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

    const userTier = effectiveTierOf(profile)
    // Pool-aware web spending (D1 v2): on consumer surfaces a payg account
    // spends its FREE pool only, under full free-tier semantics — the topup
    // pool is invisible here and stays redeemable via the developer surfaces.
    //
    // P14: a workspace payer swaps every profile-derived gate for the org
    // entitlement grade — through the ONE helper both spend sites share, so
    // the preflight and the reservation can never disagree. Without a
    // workspace context the gates are the pre-P14 derivation, verbatim.
    // `spendGates` is also what the UGC quote decides a model under.
    const gates = spendGates(userTier, surface ?? {})
    const webFree = gates.webFree
    const isFree = gates.freeSemantics
    const watermark = gates.watermarkable && FREE_TIER_RESTRICTIONS.watermark

    // The admin switch, then the tier restriction (from model_pricing table),
    // then the free-tier blocklist — through the ONE helper the UGC quote
    // also refuses with. A workspace payer is gated at the org grade
    // (`tierForGates`, and no free-tier semantics), not the member's personal
    // tier — a free-tier student's class run may use what the class may use.
    // A disabled model's refusal carries no watermark, as before.
    const unavailable = modelAvailabilityRefusal(modelIdentifier, pricing, gates)
    if (unavailable) {
      return unavailable.reason === "disabled"
        ? { allowed: false, error: unavailable.error }
        : { allowed: false, error: unavailable.error, watermark }
    }

    // Calculate total balance. In web-free mode the topup pool is excluded —
    // it never spends on a consumer surface.
    const { subscriptionCredits, topupCredits, totalBalance } = spendableBalance(profile, webFree)

    // Check if user has enough credits. BYPASSED for a workspace payer: the
    // personal pools are not what pays, and headroom is the reserve RPC's
    // atomic job (`FOR UPDATE` on the budget row) — a zero-balance member
    // doing class work must not be refused for a balance they don't need.
    if (gates.personalBalance && totalBalance < pricing.creditCost) {
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
    // economy at first purchase (mirrors the RPC's v_lifetime gate). A
    // workspace payer is outside the allowance economy entirely
    // (`appAllowance` false — the class budget pays, nothing is "earned").
    if (isAppRun && gates.appAllowance && isFree && !webFree && topupCredits === 0) {
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
    // A workspace payer skips the whole block (`dailyCapOff`): class work is
    // never personally day-capped, and the two reads would be paid for an
    // answer nothing consumes.
    let dailyLimit: number | undefined
    let dailySpent: number | undefined
    if (!gates.dailyCapOff) {
      const tierConfig = await getTierConfig(userTier)
      dailyLimit = surface?.communityInstance
        ? undefined
        : tierConfig.daily_credit_limit ?? undefined
      dailySpent = await getEffectiveDailySpent(
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
    options?: {
      watermarkOverride?: boolean
      isAppRun?: boolean
      creditOverride?: number
      skipAutoRecharge?: boolean
      webFreeMode?: boolean
      communityInstance?: boolean
      billingContext?: BillingContext
      oncePerJob?: boolean
      /** Welcome credits opt-in: ONLY the route guard sets this, and only for
       *  an extension-origin request (`consentBlockExempt`). Every other
       *  reservation for an account that still owes its consent is refused. */
      consentPendingAllowed?: boolean
    },
  ): Promise<ReserveResult> {
    // A blocked account reserves nothing, on any lane — FIRST, ahead of the
    // self-hosted skip, the zero-cost branch and the payer swap below (the
    // requester is the one blocked, not the account that pays).
    await refuseBlockedReservation(userId)

    // Self-hosted: skip reservation
    if (creditsDisabled()) {
      return { usageLogId: "self-hosted-skip", creditsReserved: 0, watermark: false }
    }

    const { watermarkOverride, isAppRun, creditOverride } = options ?? {}
    // P14: the resolved payer, carried from the lane's ONE resolve point.
    // Workspace ⇒ the RPC's workspace branch pays (p_workspace_id below) and
    // the org entitlement grade replaces every profile-derived gate.
    const ws = options?.billingContext?.payer === "workspace" ? options.billingContext : undefined
    // Deployment payer (item 9): the DEBIT user becomes the payer account
    // — the RPC's ordinary personal branch runs against the payer's pools —
    // while the positional `userId` (the requester) keeps owning the job.
    const dep = options?.billingContext?.payer === "deployment" ? options.billingContext : undefined
    const debitUserId = dep ? dep.payerId : userId

    // Get credit cost: route-supplied override or DB lookup.
    const dbPricing = await getModelCreditCostFromDB(modelIdentifier)
    const pricing = creditOverride !== undefined
      ? { ...dbPricing, creditCost: creditOverride }
      : dbPricing
    // Fetch tier once — needed for the atomic daily cap below, and (unless
    // overridden) for the watermark decision. Under a deployment payer this
    // is the PAYER's row: its grade is what the entitlement gates ran on at
    // resolve, and the requester's tier prices nothing here.
    // Welcome credits opt-in: while the offer is on, the same row carries the
    // consent-pending mark (the column exists only from migration 426, so it
    // is asked for only behind the flag; a deployment payer's row is never
    // consent-gated).
    const welcomeOffer = dep ? { enabled: false } : await getWelcomeOfferConfig()
    const { data: tierProfile } = (await supabase
      .from("profiles")
      .select("tier, subscription_tier, lifetime_topup_credits" + (welcomeOffer.enabled ? ", welcome_consent_pending" : ""))
      .eq("id", debitUserId)
      .single()) as unknown as {
      data: {
        tier: string | null
        subscription_tier: string | null
        lifetime_topup_credits: number
        welcome_consent_pending?: boolean | null
      } | null
    }
    // THE funnel for the consent block: every spend — route guard, the
    // orchestrator's worker-queued nodes, pipelines, publish workers —
    // reserves here, so an account that still owes its consent cannot spend
    // anywhere. Only the route guard may lift it, for an extension-origin
    // request. Same message the guard's 403 carries, so a node that fails
    // here says the same thing the popup does.
    if (welcomeOffer.enabled && tierProfile?.welcome_consent_pending === true && !options?.consentPendingAllowed) {
      throw new ConsentRequiredError()
    }
    const userTier = tierProfile ? effectiveTierOf(tierProfile) : "free"
    // Pool-aware web spending (D1 v2): resolved against payg-ness here so the
    // surface flag can be threaded from any web-origin caller unconditionally.
    // P14: the same helper the preflight uses swaps these gates for the org
    // grade under a workspace payer — the two sites can never disagree.
    const derivedWebFree = Boolean(options?.webFreeMode) && userTier === "payg"
    const gates = applyOrgEntitlements(
      { userTier, webFree: derivedWebFree },
      options?.billingContext,
    )
    const webFree = gates.webFree
    // The PERSONAL watermark derivation — what the zero-cost path must use
    // (no entitlement override without payment: the RPC's workspace guards
    // never ran there), and the personal payer's answer everywhere.
    const personalWatermark = watermarkOverride !== undefined
      ? watermarkOverride
      : ((userTier === "free" || derivedWebFree) && FREE_TIER_RESTRICTIONS.watermark)
    // A workspace payer never watermarks — the entitlement grade decides, and
    // it outranks even an explicit watermarkOverride (a stale personal-derived
    // override from a caller must not watermark class work). A deployment
    // payer rides the same rule: its grade (watermark: false, literal-typed)
    // decides, not the requester's free tier.
    const watermark = ws || dep ? (gates.watermarkable && FREE_TIER_RESTRICTIONS.watermark) : personalWatermark

    // Daily credit cap, enforced atomically inside reserve_credits (closes the
    // TOCTOU the read-only creditGuard preHandler left open). Free tier uses
    // FREE_TIER_RESTRICTIONS.dailyCreditCap (null since 2026-08-17 = no cap);
    // paid tiers use their configured daily_credit_limit (null = no cap).
    // Web-free payg runs ride the free cap — they ARE free-tier spending.
    // Workspace payer: no personal cap at all (`dailyCapOff`) — the RPC's
    // budget/member-cap guards are the ceiling, atomically.
    const dailyLimit: number | null = gates.dailyCapOff
      ? null
      : options?.communityInstance
        ? null // D2: connected community instances ride uncapped days
        : (userTier === "free" || webFree)
          ? FREE_TIER_RESTRICTIONS.dailyCreditCap
          : (await getTierConfig(userTier)).daily_credit_limit

    // Skip deduction for zero-cost models. The workspace payer is recorded in
    // METADATA ONLY — deliberately not in the top-level workspace_id/org_id
    // columns, because those are settlement DISPATCH KEYS: commit_credits and
    // refund_credits branch on `usage_logs.workspace_id` (migration 351), and
    // this reservation never passed a single workspace guard (membership,
    // suspension, budget — all live in the RPC branch that never ran). A
    // stamped column here would let a later metered commit debit the
    // workspace budget with no reserve-side authorization. The ENTITLEMENTS
    // stay personal-derived too (`personalWatermark`) — no override without
    // payment.
    if (options?.oncePerJob && pricing.creditCost <= 0) throw new Error("Job reservations require positive configured credits")
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
          // The RPC's own INSERT names `on_behalf_of` (migration 382, D5);
          // this bypass never reaches the RPC, so it must write the same
          // column itself or the row is money-less but also attribution-less.
          ...(dep ? { on_behalf_of: userId } : {}),
          metadata: {
            status: "reserved",
            display_cost_usd: displayCostUsd,
            // Mirrors the RPC's payer shape (migration 351) minus
            // `member_spend` — no spend row was touched, nothing to reverse.
            ...(ws ? { payer: { kind: "workspace", workspace_id: ws.workspaceId, org_id: ws.orgId } } : {}),
            // `allowance_enforced: false` is load-bearing, not decoration.
            // `commit_credits` and `refund_credits` branch on
            // `COALESCE((metadata->'payer'->>'allowance_enforced')::BOOLEAN, FALSE)`
            // (D4), so a missing key already reads as false — but writing it
            // explicitly is what makes the shape identical to the RPC's, and a
            // bypass row that ever said `true` would settle against a
            // reservation that never happened. Zero credits were reserved
            // here; nothing can ever be reversed.
            ...(dep ? { payer: { kind: "deployment", account: dep.payerId, allowance_enforced: false } } : {}),
          },
        })
        .select("id")
        .single()

      return {
        usageLogId: usageLog?.id ?? "log-failed",
        creditsReserved: 0,
        // Workspace keeps the personal derivation ("no override without
        // payment" — the RPC's workspace guards never ran on a free row). A
        // DEPLOYMENT payer's grade applies even here: it is boot
        // configuration, not per-request authorization — there is no guard
        // whose absence would make the override unearned, and a white-label
        // instance must not watermark a free-tier requester's zero-cost job.
        watermark: dep ? watermark : personalWatermark,
      }
    }

    // Atomic reservation via single RPC (deducts credits + increments daily
    // spent + creates usage log). `p_workspace_id` (P14) routes the RPC into
    // its workspace branch — membership, suspension, member cap and budget
    // headroom under FOR UPDATE. The key is spread conditionally so the
    // personal call's wire shape stays byte-identical to pre-P14.
    const { data: reserveData, error: reserveError } = await supabase.rpc(options?.oncePerJob ? "reserve_job_credits" : "reserve_credits", {
      p_user_id: debitUserId,
      p_credits: pricing.creditCost,
      p_job_id: jobId,
      p_model_identifier: modelIdentifier,
      p_provider_cost_usd: providerCostUsd,
      p_display_cost_usd: displayCostUsd,
      p_is_app_run: isAppRun ?? false,
      p_daily_limit: dailyLimit,
      p_web_free_mode: webFree,
      ...(options?.oncePerJob ? { p_watermark: watermark } : {}),
      ...(ws ? { p_workspace_id: ws.workspaceId } : {}),
      // Track A / D3 — TWO switches, spread conditionally so the personal
      // call's wire shape stays byte-identical (both parameters are trailing
      // and DEFAULTED in 382, so even a database that has the new function
      // behaves exactly as before when they are absent).
      //
      // `p_on_behalf_of` is ATTRIBUTION: the RPC writes the requester into
      // `usage_logs.on_behalf_of` in its own INSERT. `p_enforce_allowance` is
      // ENFORCEMENT and is the ONLY thing in this track that can refuse a
      // generation; it stays false until the overlay flips
      // `billing.allowances` to "enforce".
      //
      // The payer's own run passes NEITHER (D13). 382 exempts it too
      // (`p_on_behalf_of <> p_user_id`), but leaning on that would make the
      // payer's runs depend on a SQL condition rather than on the fact that
      // the payer simply has no allowance — it owns the pool.
      ...(dep && userId !== dep.payerId
        ? { p_on_behalf_of: userId, p_enforce_allowance: allowanceEnforcementActive() }
        : {}),
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

    if (options?.oncePerJob) {
      const result = reserveData as { usageLogId?: unknown; creditsReserved?: unknown; watermark?: unknown; replayed?: unknown } | null
      if (!result || typeof result.usageLogId !== "string" || result.creditsReserved !== pricing.creditCost
        || typeof result.watermark !== "boolean" || typeof result.replayed !== "boolean") {
        throw new Error("Job reservation response could not be verified")
      }
      // The SQL boundary already persisted the job pointer and debit ledger.
      // Returning here prevents the legacy post-RPC writes from duplicating it.
      if (pricing.creditCost > 0) await authorizeExternalReservation(result.usageLogId, userId)
      if (dep) await invalidateRequesterBalance(userId)
      if (!result.replayed && !options.skipAutoRecharge && !ws && !dep) void attemptAutoRecharge(userId)
      return { usageLogId: result.usageLogId, creditsReserved: pricing.creditCost, watermark: result.watermark }
    }
    const usageLogId = reserveData

    if (!usageLogId) {
      console.error("[credits] reserve_credits returned null usage log ID")
      if (externalWalletActive()) throw new Error("External wallet requires a durable local reservation")
      return { usageLogId: "log-failed", creditsReserved: pricing.creditCost, watermark }
    }

    await authorizeExternalReservation(usageLogId, userId)

    // The post-hoc `on_behalf_of` UPDATE that used to live here is GONE (D5).
    // Migration 382's `reserve_credits` names the column in its OWN insert, so
    // attribution is now written in the same transaction as the debit instead
    // of by a second statement that could fail on its own — which it did,
    // loudly, on any database that predated migration 362, leaving rows whose
    // money moved but whose attribution did not. Re-adding a write here would
    // be a redundant UPDATE on a row the RPC already stamped.
    //
    // The requester's cached balance must be dropped, though: under a payer
    // that read carries the requester's ALLOWANCE, and a 15-second stale
    // sidebar shows credits they no longer have. Reached through `await
    // import` because a static ee/billing -> ee/routes edge closes a cycle
    // (routes/credits.ts imports this module); `signup-grant.ts:51` is the
    // precedent.
    if (dep) await invalidateRequesterBalance(userId)

    // Fetch usage_log metadata (from_sub/from_topup) for accurate creditType,
    // and current user balance for accurate balanceAfter (C3 + H6 fix).
    // Workspace payer: SKIPPED — the money moved in the workspace budget, the
    // personal pools are untouched, and the ledger row is org-shaped below.
    let creditType: "subscription" | "topup" | "org" = ws ? "org" : "subscription"
    let balanceAfter = 0
    if (!ws) {
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
            // The DEBIT user's pools — under a deployment payer the money
            // moved on the payer account, and a requester-keyed balanceAfter
            // would report a pool this reservation never touched.
            .eq("id", debitUserId)
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
    }

    // Log credit transaction. Org rows carry the workspace/org pair and
    // `credit_type: 'org'` — never a personal-shaped debit row for money that
    // didn't move personally (the personal-history views filter on this; P15
    // joins on it). `balance_after: 0` matches the RPC's own org-row
    // convention (migration 351 omits it → column default) — the personal
    // balance did not move, and the workspace budget lives in
    // workspace_budgets, not here.
    await CreditsService.logTransaction({
      // The ledger row belongs to whoever's money moved: the payer account
      // under a deployment payer (its transactions page is the instance
      // owner's audit trail; the requester's shows nothing — their balance
      // did not move), the requester otherwise.
      userId: debitUserId,
      amount: -pricing.creditCost,
      creditType,
      // org_usage (a 351 CHECK value, prepared for exactly these rows) so
      // org usage is distinguishable from personal usage by source as well
      // as by the pair — P15's reporting convention starts here.
      source: ws ? "org_usage" : "usage",
      description: dep
        ? `Job ${jobId}: ${modelIdentifier} (on behalf of ${userId})`
        : `Job ${jobId}: ${modelIdentifier}`,
      jobId,
      balanceAfter,
      ...(ws ? { workspaceId: ws.workspaceId, orgId: ws.orgId } : {}),
    })

    // Successful reserve = the only place balances DECREASE — fire the
    // auto-recharge check (best-effort, never blocks). Third-party-app
    // attributed operations are excluded via skipAutoRecharge. A WORKSPACE
    // payer is excluded as an invariant, not a call-site flag: the member's
    // personal balance did not move, and class work must never charge a
    // member's saved card. A DEPLOYMENT payer is excluded the same way —
    // prepaid-only by contract; the payer account must never pump a card.
    if (!options?.skipAutoRecharge && !ws && !dep) {
      void attemptAutoRecharge(userId)
    }
    return { usageLogId: usageLogId as string, creditsReserved: pricing.creditCost, watermark }
  }

  /** Detect opt-in settlement before callers reprice or overwrite actual costs. */
  static async trySettleManagedCredits(usageLogId: string): Promise<boolean> {
    if (creditsDisabled() || usageLogId === "self-hosted-skip") return false
    const requester = await settlementRequester(usageLogId)
    try { return await trySettleManagedJob(usageLogId) }
    finally { await invalidateRequesterBalance(requester); void deliverExternalWalletSettlements(usageLogId) }
  }

  /**
   * Settle managed jobs from their saved decision; legacy rows retain the
   * existing commit RPC. Deployment-payer allowance invalidation wraps both.
   */
  static async commitCredits(
    usageLogId: string,
    actualCredits?: number
  ): Promise<void> {
    if (creditsDisabled() || usageLogId === "self-hosted-skip") return
    const requester = await settlementRequester(usageLogId)
    try {
      if (await trySettleManagedJob(usageLogId)) return
      await CreditsService.settleCommit(usageLogId, actualCredits)
    } finally {
      await invalidateRequesterBalance(requester)
      void deliverExternalWalletSettlements(usageLogId)
    }
  }

  private static async settleCommit(
    usageLogId: string,
    actualCredits?: number
  ): Promise<void> {

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
      .select("workspace_id, metadata, on_behalf_of")
      .eq("id", usageLogId)
      .maybeSingle()
    if (payerRow?.workspace_id || payerRow?.metadata?.external_wallet === true) {
      console.error(
        `[credits] commit fallback REFUSED for workspace-paid usage log ${usageLogId} — row left reserved for RPC retry`,
      )
      return
    }

    // ALLOWANCE-AWARE (Track A): the deployment analogue of the case above, and
    // it strands quota the same way. An enforced reservation lives in TWO
    // places — the payer's pools and `deployment_user_allowances.reserved_
    // credits` — and only `commit_credits` moves the second (382:689). Flipping
    // the status here would settle the money and leave the requester's reserved
    // credits held forever: both SQL settlers key on `status = 'reserved'`, and
    // `commitReservedCreditsForJob`/`refundReservedCreditsForJob` only ever
    // fetch reserved rows, so nothing in the codebase could release it
    // afterwards — the sole repair being a manual correction grant from the
    // billing account. Left `reserved`, ONE later `commit_credits(id)` still
    // heals money and allowance together: a recoverable strand, which is the
    // trade billing-04/H22 already made above.
    if (holdsEnforcedAllowance(payerRow)) {
      console.error(
        `[credits] commit fallback REFUSED for allowance-enforced usage log ${usageLogId} — row left reserved for RPC retry`,
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
   *
   * Same Track A wrapper as {@link commitCredits}, and the case that matters
   * most: a refund gives the requester's allowance back for free (the ledger
   * is reserved/spent, not derived from log status), so a stale sidebar here
   * shows a user less than they have and can talk them out of a retry.
   */
  static async refundCredits(usageLogId: string): Promise<void> {
    if (creditsDisabled() || usageLogId === "self-hosted-skip") return
    const requester = await settlementRequester(usageLogId)
    try {
      if (await trySettleManagedJob(usageLogId)) return
      await CreditsService.settleRefund(usageLogId)
    } finally {
      await invalidateRequesterBalance(requester)
      void deliverExternalWalletSettlements(usageLogId)
    }
  }

  private static async settleRefund(usageLogId: string): Promise<void> {

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
      .select("user_id, job_id, credits_used, status, metadata, workspace_id, on_behalf_of")
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
    if ((usageLog as { workspace_id?: string | null }).workspace_id || usageLog.metadata?.external_wallet === true) {
      console.error(
        `[credits] refund fallback REFUSED for workspace-paid usage log ${usageLogId} — row left reserved for RPC retry`,
      )
      return
    }

    // ALLOWANCE-AWARE (Track A): the worst case of the whole fallback. The
    // requester's `reserved_credits` was bumped by `reserve_credits` and only
    // `refund_credits` releases it (382:855). This fallback restores the
    // PAYER's pools correctly and never touches the ledger — so a job that
    // failed and was fully refunded would still have consumed the requester's
    // quota, permanently: the status is now 'refunded', both SQL settlers
    // require 'reserved', and nothing anywhere recomputes
    // `deployment_user_allowances.reserved_credits`. Every recurrence subtracts
    // again. Leave it reserved and loud instead; `refund_credits(id)` on a
    // later retry releases money and quota in one transaction.
    if (holdsEnforcedAllowance(usageLog as { metadata?: unknown; on_behalf_of?: string | null })) {
      console.error(
        `[credits] refund fallback REFUSED for allowance-enforced usage log ${usageLogId} — row left reserved for RPC retry`,
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
   * Does the payer's spendable balance cover `credits`? The same pools the
   * reservation reads: the payer's profile (a deployment payer's row, else the
   * requester's), the subscription pool plus the top-up pool, the top-up pool
   * excluded on a web surface for a pay-as-you-go account (`webFreeMode`).
   * A workspace payer is never refused here: its personal pools are not what
   * pays, and the headroom is the reserve RPC's atomic job. A profile that
   * cannot be read passes (the per-node reservation refuses, as
   * `checkAppRunEligibility` does). With credits disabled it passes.
   */
  static async checkBalanceCovers(
    userId: string,
    credits: number,
    billingContext?: BillingContext,
    webFreeMode?: boolean,
  ): Promise<{ ok: true } | { ok: false; balance: number }> {
    if (creditsDisabled()) return { ok: true }

    const { data: profile } = await supabase
      .from("profiles")
      .select("tier, subscription_tier, lifetime_topup_credits, subscription_credits, topup_credits")
      .eq("id", payerProfileId(userId, billingContext))
      .single()
    if (!profile) return { ok: true }

    const gates = spendGates(
      effectiveTierOf(profile as unknown as { tier: string | null; subscription_tier: string | null; lifetime_topup_credits: number }),
      { webFreeMode, billingContext },
    )
    if (!gates.personalBalance) return { ok: true }

    const balance = ((profile.subscription_credits as number | null) ?? 0) + (gates.webFree ? 0 : ((profile.topup_credits as number | null) ?? 0))
    return balance >= credits ? { ok: true } : { ok: false, balance }
  }

  /**
   * Get credit cost for a specific model — the single PUBLIC lookup
   * (`GET /v1/credits/model-cost`). A speech `:per-100-chars` row is refused
   * while length pricing is off, exactly as an id priced nowhere is: the
   * reservation seams read `getModelCreditBaseCost` and are not affected.
   */
  static async getModelCreditCost(modelIdentifier: string): Promise<number> {
    if (!speechUnitRowServed(modelIdentifier)) throw new PriceNotConfiguredError(modelIdentifier)
    const pricing = await getModelCreditCostFromDB(modelIdentifier)
    return pricing.creditCost
  }

  /**
   * What a run of this workflow will be charged, reading node data for
   * variable-cost nodes. Mirrors the frontend getModelIdentifier() logic for
   * composite model identifiers, and prices every node the way its
   * reservation will: `model_pricing` over `STATIC_CREDIT_COSTS`, marked up
   * once per node (`getChargedPriceTable`).
   */
  static async estimateWorkflowCredits(
    nodes: ReadonlyArray<EstimateNode>,
    /** The workflow's edges, when the caller has them. Some prices are a GRAPH
     *  fact (does an edge feed add-captions a timed caption source?). Without
     *  edges the estimator assumes the pricier answer — never under-quote. */
    edges?: ReadonlyArray<EstimateEdge>,
    options?: WorkflowEstimateOptions,
  ): Promise<number> {
    // Without a credit system nothing is charged, so there is no price table
    // to read: the figure stays the static one these editions always showed.
    const prices = hasCredits() ? await getChargedPriceTable() : STATIC_BASE_PRICES
    // UGC graphs (Cloud only): the clip model and length live in the plugin, so the UGC part is priced through
    // its seam (spec 6.8). The UGC nodes, and the nodes downstream of UGC Clip that the seam's figure already
    // counts as its fixed lines, stay out of the per-node sum; they stay IN the graph the sum reads, so the
    // preview stop rule still sees every wire.
    const ugc = await ugcPartOf(nodes, edges)
    return sumWorkflowEstimate(nodes, edges, prices, options, ugc?.skip) + (ugc?.credits ?? 0)
  }

  /**
   * The same estimate at `STATIC_CREDIT_COSTS`' base prices, with no database
   * read and no markup. Nothing a user sees should quote it — it pins which
   * identifier each node is estimated at.
   */
  static estimateWorkflowBaseCredits(
    nodes: ReadonlyArray<EstimateNode>,
    edges?: ReadonlyArray<EstimateEdge>,
    options?: WorkflowEstimateOptions & { readonly editPlanPerMinute?: boolean },
  ): number {
    return sumWorkflowEstimate(nodes, edges, staticBasePrices(options?.editPlanPerMinute), options)
  }

  /**
   * The listing (`estimateWorkflowListingCredits`) at `STATIC_CREDIT_COSTS`'
   * base prices, with no database read, no markup and no UGC seam: what a
   * built-in template's stored price pins.
   */
  static estimateWorkflowBaseListing(
    nodes: ReadonlyArray<EstimateNode>,
    edges: ReadonlyArray<EstimateEdge> | undefined,
    publishType: ListingPublishType,
    options?: {
      readonly replaceableMediaNodeIds?: ReadonlySet<string>
      readonly exposedListNodeIds?: ReadonlySet<string>
      readonly editPlanPerMinute?: boolean
      readonly speechTextCaps?: ExposedTextCaps
    },
  ): AppListingEstimate {
    return listingEstimate(nodes, edges ?? [], staticBasePrices(options?.editPlanPerMinute), publishType, undefined, options?.speechTextCaps, options?.replaceableMediaNodeIds, options?.exposedListNodeIds)
  }
}

/**
 * What a workflow estimate quotes. A RUN estimate (the default) quotes what
 * one run executes, so the preview stop rule leaves out what a Preview render
 * gates. A WHOLE-GRAPH estimate (`scope: "whole-graph"`) counts every node,
 * whatever the stop rule's flag says (decided 2026-10-05): it is a listing's
 * preview part (`estimateWorkflowListingCredits`, which stores the figure at
 * publish).
 */
export type WorkflowEstimateOptions = {
  scope?: "run" | "whole-graph"
  /** EVERY exposed text input of a published app, "<nodeId>:<field>" → its
   *  character limit, or null when it has none (built at publish from the
   *  presentation items). A limit caps the ceiling an unknown speech text is
   *  priced at; an exposed field without one makes a node's stored text UNKNOWN
   *  (it is a placeholder the app user replaces); an absent key means the field
   *  is not exposed and a literal text is priced exactly. Never shrinks a
   *  literal, unexposed text. */
  speechTextCaps?: ExposedTextCaps
  /** A run of a SUBSET (Render final, a continued run): price only these
   *  nodes. The rest of the graph is still the context a price reads (a
   *  wired setting, a caption source, the stop rule's closure). */
  runNodeIds?: ReadonlySet<string>
}

/**
 * A listing in two parts (decided 2026-10-06), for an app, a component and a
 * template alike:
 *
 * - PREVIEW — the WHOLE graph, every node at its saved settings (each render
 *   set to Preview at Preview). The creator's fee applies to this part.
 * - FINAL — each Render final: the render at Final and everything after it,
 *   run outside the app run without the fee. A node after two Preview renders
 *   is counted in each of their finals. An app with no Preview render has
 *   none; a component never stops at a Preview, so its final part is 0.
 *
 * Never under-quote: with the preview stop rule off an app run executes the
 * whole graph at Preview and the fee applies to all of it, and a final never
 * stops at a later Preview; staging and production share one database, so
 * the stored listing cannot follow the flag. With the flag on, a run leaves
 * the tail for its final, and a final stops at a later Preview, so both parts
 * can over-quote (accepted). Revisit when production turns the flag on.
 * Each part is FIXED credits plus credits PER MINUTE of the episode (decided
 * 2026-10-07): a part whose price follows a recording whose length is not
 * known when it is listed (an Edit Plan's planning pass, a tighten's render)
 * lists that part per minute, never at the 180-minute maximum and never at a
 * guessed length. A listing with no such part has 0 per minute and reads
 * exactly as before. A node is counted once per run it makes (`nodeFanOut`:
 * clips, list items, ideas, repeats), each of several providers at its own price.
 * A recording the app user or a template's cloner replaces has no known
 * length, whatever sample the creator saved (review F2, decided 2026-10-07):
 * its length-dependent parts list per minute.
 *
 * Stored and priced by `lib/app-listing-price.ts`.
 */
export interface AppListingEstimate {
  /** The preview part's fixed credits. */
  readonly preview: number
  /** The final part's fixed credits. */
  readonly final: number
  /** The preview part's credits per minute of the episode (0 when none). */
  readonly previewPerMinute: number
  /** The final part's credits per minute of the episode (0 when none). */
  readonly finalPerMinute: number
  /** The preview part's credits per item beyond the creator's saved count, for
   *  a List the app's user fills (decided 2026-10-07; absent when none). A
   *  part per minute that a further item adds is folded in at 180 minutes. */
  readonly previewPerItem?: number
  /** The final part's credits per further item (absent when none). */
  readonly finalPerItem?: number
}

/** What is being listed: an app, a component (never stops at a Preview), or a template. */
export type ListingPublishType = "app" | "component" | "template"

/** `STATIC_CREDIT_COSTS` as a price table: the base prices, unmarked. */
const STATIC_BASE_PRICES: ChargedPriceTable = {
  base: (identifier) => editPlanMinutesBase(identifier, (id) => STATIC_CREDIT_COSTS[id]) ?? STATIC_CREDIT_COSTS[identifier],
  charge: (_identifier, baseCredits) => baseCredits,
}

/** The static base prices, charged per started minute for Edit Plan when asked. */
const staticBasePrices = (editPlanPerMinute: boolean | undefined): ChargedPriceTable =>
  editPlanPerMinute ? { ...STATIC_BASE_PRICES, editPlanPerMinute: true } : STATIC_BASE_PRICES

function sumWorkflowEstimate(
  nodes: ReadonlyArray<EstimateNode>,
  edges: ReadonlyArray<EstimateEdge> | undefined,
  prices: ChargedPriceTable,
  options: WorkflowEstimateOptions | undefined,
  /** Nodes priced elsewhere (the UGC seam): read as part of the graph, never summed. */
  skip?: (node: EstimateNode) => boolean,
): number {
  // A run stops at a Preview render: what it gates runs only after Render
  // final, so the estimate of this run leaves it out (the stop rule, through
  // its rollout flag — off, nothing is left out). Without edges the closure is
  // unknown, and the estimate keeps every node — never under-quote. A listing
  // estimate never asks the rule: it prices the whole graph.
  const wholeGraph = options?.scope === "whole-graph"
  const previewGated = edges && !wholeGraph
    ? previewStopsWhenEnabled(
        // Every feed the rule follows rides along: Group membership
        // (`parentId`) on the nodes, and the wire's handle and mode on the
        // edges — the same graph the editor's estimate hands it.
        nodes.flatMap((n) => (n.id ? [{ id: n.id, type: n.type, data: n.data, parentId: n.parentId }] : [])),
        edges.flatMap((e) =>
          e.source
            ? [{ source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle, data: e.data }]
            : [],
        ),
      ).gatedNodeIds
    : new Set<string>()
  const runNodeIds = options?.runNodeIds
  // The nodes the run executes (a frozen node hands on what it holds): a
  // planner among them re-plans, so a render after it follows the episode;
  // one outside them hands on its saved plan, whose length is exact. The
  // editor's estimate passes its executable set the same way.
  const rerunIds = runNodeIds ?? new Set(nodes.flatMap((n) => (n.id && !isFrozenNode(n) ? [n.id] : [])))
  return sumEstimatedNodes(nodes, edges, prices, (node) => {
    if (runNodeIds && !(node.id && runNodeIds.has(node.id))) return false
    if (node.id && previewGated.has(node.id)) return false
    return !skip?.(node)
  }, rerunIds, options?.speechTextCaps)
}

/** A frozen node (`data.skipped`) does not run: it hands on what it holds. */
const isFrozenNode = (n: EstimateNode): boolean => (n.data as { skipped?: unknown } | undefined)?.skipped === true

/**
 * The run estimate of the nodes `include` keeps: each node once per run it
 * makes (`nodeFanOut`: a clips plan's clips, a List's items, a Content Ideas'
 * ideas and other Each wires, times the Repeat count), each of several
 * providers at its own price, an Apply EDL render at the minutes it will
 * render (`graphPricingUnits`). The same rules the listing reads
 * (`sumListingParts`) and the editor's estimate reads, so a run estimate is
 * the listing at the 180-minute cap and the editor's figure for the same
 * graph (decided 2026-10-07).
 */
function sumEstimatedNodes(
  nodes: ReadonlyArray<EstimateNode>,
  /** Undefined when the caller has no wiring: a price that is a graph fact assumes the pricier answer. */
  edges: ReadonlyArray<EstimateEdge> | undefined,
  prices: ChargedPriceTable,
  include: (node: EstimateNode) => boolean,
  /** The nodes the priced run executes (see `sumWorkflowEstimate`). */
  rerunIds: ReadonlySet<string>,
  /** The app's exposed text inputs, when the caller has them (see `WorkflowEstimateOptions.speechTextCaps`). */
  speechTextCaps?: ExposedTextCaps,
): number {
  const gateNodes = listingGateNodes(nodes)
  const gateEdges = listingGateEdges(edges ?? [])
  const unitsOf = (n: EstimateNode) => graphPricingUnits(n, nodes, edges, rerunIds)
  const wireSec = runWireLengthOf(nodes, edges, rerunIds)
  return nodes.reduce((sum, node) => {
    if (!include(node)) return sum
    const runs = nodeFanOut({ id: node.id ?? "", type: node.type, data: node.data }, gateNodes, gateEdges, rerunIds)
    return runs === 0 ? sum : sum + runs * oneRunCredits(node, nodes, edges, prices, speechTextCaps, unitsOf, wireSec)
  }, 0)
}

/**
 * One run of a node: each of several providers at its own price (the run's
 * own expansion, `nodeProviders`), else the node at its own. The run
 * estimate and the listing both price a node's run through this.
 */
function oneRunCredits(
  node: EstimateNode,
  nodes: ReadonlyArray<EstimateNode>,
  edges: ReadonlyArray<EstimateEdge> | undefined,
  prices: ChargedPriceTable,
  speechTextCaps: ExposedTextCaps | undefined,
  unitsOf: (node: EstimateNode, priced: EstimateNode) => number,
  wireSec: WireSecOf,
): number {
  const variants = nodeProviders(node.type, node.data)?.map((provider) => ({ ...node, data: { ...(node.data ?? {}), provider } })) ?? [node]
  return variants.reduce((t, v) => t + estimateNodeCredits(v, nodes, edges, prices, speechTextCaps, unitsOf, wireSec), 0)
}

/** The length, in seconds, of the video on a wire when a run is estimated; undefined when not known. */
type WireSecOf = (sourceId: string | undefined) => number | undefined

/**
 * A run estimate's read of a wire's video length (`runWireLengthSec`, shared
 * with the editor's estimate): a render's output at the render's estimated
 * minutes and a chain of Trim / Loop / Combine Videos / Video SFX at the
 * length each passes on, so a Combine Videos on a render is priced at the
 * render's length, as the listing prices it (decided 2026-10-07). Any other
 * source is not read (the estimators' fallback length stands in).
 */
function runWireLengthOf(
  nodes: ReadonlyArray<EstimateNode>,
  edges: ReadonlyArray<EstimateEdge> | undefined,
  rerunIds: ReadonlySet<string>,
): WireSecOf {
  if (!edges) return () => undefined
  const gateNodes = listingGateNodes(nodes)
  const gateEdges = listingGateEdges(edges)
  return (sourceId) => runWireLengthSec(sourceId, gateNodes, gateEdges, rerunIds)
}

/**
 * A video-utility estimate body with the length of each wire that feeds it,
 * in wire order (the order of `videoUrls`): Combine Videos prices each clip at
 * its own length, Trim and Loop their one input's. A wire with no known length
 * stays `undefined`, and the estimator falls back for that position. The
 * listing and the run estimate both build their price through this.
 */
function withUpstreamLengths(type: string, body: Record<string, unknown>, secs: ReadonlyArray<number | undefined>): Record<string, unknown> {
  return type === "combine-videos" ? { ...body, upstreamDurations: secs } : { ...body, upstreamDuration: secs[0] }
}

/** One node's estimate, priced as a run of it would be (`sumEstimatedNodes`' term). */
function estimateNodeCredits(
  node: EstimateNode,
  nodes: ReadonlyArray<EstimateNode>,
  edges: ReadonlyArray<EstimateEdge> | undefined,
  prices: ChargedPriceTable,
  speechTextCaps: ExposedTextCaps | undefined,
  unitsOf: (node: EstimateNode, priced: EstimateNode) => number,
  wireSec: WireSecOf,
): number {
  // A parameter node (Provider, Duration, a picker) is read, never run: no
  // job, no charge. A Provider's data names a model ("veo3"), which the
  // lookups below would otherwise price as a run of that model. The editor's
  // estimate already counts executable nodes only.
  if (PARAMETER_NODE_TYPES.has(node.type)) return 0
  // Image Overlay is base + 2 per extra platform render — the shared formula,
  // marked up once as a whole, the way its route's creditGuard reserves it.
  if (node.type === "image-overlay") {
    return prices.charge("image-overlay", imageOverlayCredits((node.data?.variants as unknown[] | undefined)))
  }
  // Trim / Loop / Combine / Assemble Narrated Video are priced per unit of
  // what they make — the same estimator the route and the workflow run
  // charge with (lib/video-utility-credits.ts), marked up once as a whole.
  const utilityBody = videoUtilityEstimateBody(node, edges)
  if (utilityBody) {
    // A wire whose length a run estimate knows (a render's output, a chain of
    // these steps) is priced at it; the rest at the estimators' fallback.
    const incoming = node.id === undefined || !edges ? [] : edges.filter((e) => e.target === node.id)
    const secs = incoming.map((e) => wireSec(e.source))
    const body = secs.some((sec) => sec !== undefined) ? withUpstreamLengths(node.type, utilityBody, secs) : utilityBody
    const base = videoUtilityBaseCredits(node.type, body)
    if (base !== undefined) return prices.charge(node.type, base)
  }
  const priced = withWiredSettings(node, nodes, edges)
  // Text to Speech / Text to Dialogue by length (decided 2026-10-06): the
  // model's :per-100-chars row × started hundreds of the text the run will
  // send, at least 8 units — the id and the units from ONE call, so they can
  // never flip apart. A connected text follows the edge one hop (a literal
  // Text node is exact; an exposed Text input's limit caps it). Undefined
  // while the flag is off: the flat row below, byte for byte.
  const speech = speechEstimate(priced.type, priced.data ?? {}, upstreamSpeechText(priced, nodes, edges ?? [], speechTextCaps ?? {}))
  if (speech) return (chargedCredits(prices, speech.id, speech.units) ?? chargedCredits(prices, node.type) ?? 0)
  const modelId = getNodeModelIdentifier(priced, {
    timedCaptionSourceWired: timedCaptionSourceWired(node, nodes, edges),
    audioSyncSourceCount: audioSyncWiredSourceCount(node, edges),
    editPlan: node.type === "edit-plan" ? { sourceSec: editPlanSourceSecOf(node, nodes, edges), perMinute: prices.editPlanPerMinute === true } : undefined,
    videoSfxSec: node.type === "video-sfx" ? videoSfxClipSecOf(node, edges, wireSec) : undefined,
  })
  return (chargedCredits(prices, modelId, unitsOf(node, priced)) ?? chargedCredits(prices, node.type) ?? 0)
}

/**
 * The clip length a Video SFX is priced at when a run is estimated: its
 * `video` wire's length where a run estimate knows it (a render's output, a
 * chain of Trim / Loop / Combine Videos / Video SFX), at most the 300 seconds
 * a run accepts, as the listing prices it (`videoSfxClipSec`, decided
 * 2026-10-07). Undefined when no wire's length is known: the unmeasured-clip
 * row stands in.
 */
function videoSfxClipSecOf(
  node: EstimateNode,
  edges: ReadonlyArray<EstimateEdge> | undefined,
  wireSec: WireSecOf,
): number | undefined {
  if (node.id === undefined || !edges) return undefined
  const inputs = edges.filter((e) => e.target === node.id)
  return videoSfxClipSec(inputs, inputs.map((e) => wireSec(e.source)))
}

/**
 * An Edit Plan node's master source length in seconds, read the way the editor
 * and the reserve read it (`resolveEditPlanEstimateDurationSec`: the declared
 * master, else the first wired source, through teleports). Undefined without
 * an id or edges, or when the source's length is unknown: the 180-minute
 * maximum is then quoted — never under the reserve.
 */
function editPlanSourceSecOf(
  node: EstimateNode,
  nodes: ReadonlyArray<EstimateNode>,
  edges: ReadonlyArray<EstimateEdge> | undefined,
): number | undefined {
  if (!node.id || !edges) return undefined
  return resolveEditPlanEstimateDurationSec({ id: node.id, type: node.type, data: node.data }, listingGateNodes(nodes), listingGateEdges(edges))
}

/** A listed node's credits: fixed, and per minute of the episode. */
interface ListingParts {
  readonly fixed: number
  readonly perMinute: number
}

const NO_PARTS: ListingParts = { fixed: 0, perMinute: 0 }

/**
 * Edit Plan's two parts from its price rows (decided 2026-10-07): the flat row
 * fixed, the rate row per minute, read from the live rows so an admin retune is
 * listed as charged. Each is marked up at the 180-minute id (the same prefix a
 * reserve's margin matches). `undefined` when a row is missing: the caller
 * lists the ceiling, as before.
 *
 * Exact per started minute when the plugin charges that way
 * (`supports().editPlanPerMinute`). On a plugin that still reserves the
 * 15/30/60/90/120/180-minute step, a run between steps is charged above this,
 * and the public "never quotes less" sentences name that exception.
 */
function editPlanListingParts(prices: ChargedPriceTable, mode: string, tier: string): ListingParts | undefined {
  const m = asEditPlanMode(mode)
  const t = asEditPlanTier(tier)
  const hiId = buildEditPlanCreditId(m, t, EDIT_PLAN_MAX_MINUTES * 60)
  const flat = prices.base(editPlanFlatCreditId(m, t))
  const rate = prices.base(editPlanRateCreditId(m, t))
  if (flat === undefined || rate === undefined) return undefined
  // Up to a whole credit, never down.
  const whole = (x: number) => Math.ceil(x - 1e-9)
  return { fixed: whole(flat) > 0 ? prices.charge(hiId, whole(flat)) : 0, perMinute: prices.charge(hiId, whole(rate)) }
}

// The steps charged by the length of the video they are given (decided
// 2026-10-07): Trim, Loop and Combine Videos (`videoUtilityBaseCredits`, per
// 5 seconds of output) and Video SFX (a row per clip length, at most 300 s:
// on any recording the user replaces it lists that last row, fixed). The
// editor's and the run estimate's stand-in length is the 8-second fallback,
// which a listing cannot use for a recording it does not know. Each also
// passes a length on to the step after it, as does every other video producer
// (`VIDEO_OUTPUT_LENGTH_RULES`), so a chain of them on the episode lists per
// minute of it too. The set of steps and their pass-on rule live in
// `@nodaro/render-rules`, where the run estimates read them; the registry reads
// the same rule.

/** The recording node types a listing reads a length from: the uploads an app exposes and the Video URL (YouTube or any link) node, which the user replaces the same way (decided 2026-10-07). */
const RECORDING_SOURCE_TYPES: ReadonlySet<string> = new Set(["upload-video", "upload-audio", "reference-audio", "youtube-video"])

/**
 * The replaced recordings that ARE the episode the per-minute figure counts:
 * those wired (through teleports) into an Edit Plan's sources or a Transcribe
 * node, else the only replaced recording (a Video URL counts only when no
 * upload or audio recording is replaced beside it). A second recording the user gives
 * (Trailer + Formats' intro card) is not the episode: the listing has no unit
 * for its length, so Trim, Loop and Combine Videos on it stay at the
 * estimators' fallback length, a documented exception (decided 2026-10-07).
 */
function episodeRecordingIds(
  nodes: ReadonlyArray<EstimateNode>,
  edges: ReadonlyArray<EstimateEdge>,
  replacedMediaIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const gateNodes = listingGateNodes(nodes)
  const gateEdges = listingGateEdges(edges)
  const typeOf = new Map(gateNodes.map((n) => [n.id, n.type]))
  const replacedRecordings = [...replacedMediaIds].filter((id) => RECORDING_SOURCE_TYPES.has(typeOf.get(id) ?? ""))
  const episode = new Set<string>()
  for (const e of gateEdges) {
    const target = typeOf.get(e.target)
    if (!((target === "edit-plan" && e.targetHandle === "sources") || target === "transcribe")) continue
    const origin = resolveGraphOrigin(gateNodes.find((n) => n.id === e.source), gateNodes, gateEdges)
    if (origin && replacedRecordings.includes(origin.id)) episode.add(origin.id)
  }
  if (episode.size === 0) {
    // The only replaced recording is the episode. A Video URL is a reference more
    // often than a recording, so it never takes that slot from an upload or audio
    // recording: the fallback counts those first, and a link is the episode on its
    // own only when it is the one replaced recording (decided 2026-10-07).
    const files = replacedRecordings.filter((id) => typeOf.get(id) !== "youtube-video")
    const only = files.length > 0 ? files : replacedRecordings
    if (only.length === 1) episode.add(only[0]!)
  }
  return episode
}

/**
 * How long the video on a wire is, when a listing can say (decided 2026-10-07):
 * the episode recording the app user or the cloner replaces is 60 seconds per
 * minute of the episode; a recording the user cannot replace is its own known
 * length; a render's output is the render's own estimated length, per minute of
 * the episode when the render's is (`resolveApplyEdlEstimateLength`, the rule
 * the render itself is listed by); and every other video producer is its
 * length rule (`VIDEO_OUTPUT_LENGTH_RULES`, lib/video-output-length.ts): a
 * generation its configured duration, a pass-through step its input's length,
 * an extension its input plus what it adds, an audio-driven step the audio's
 * capped at what its run accepts, each read by the functions its run prices
 * with and never below the length the next step's run reads off the node.
 * A second recording the user replaces, or a producer no rule can bound, is
 * `"unknown"`: Trim, Loop and Combine Videos stand at the estimators' fallback
 * length for it, Video SFX at its 300-second row. `undefined` for a node that
 * is not media (or a cycle).
 */
function wireInputLength(
  sourceId: string | undefined,
  nodes: ReadonlyArray<EstimateNode>,
  edges: ReadonlyArray<EstimateEdge>,
  replacedMediaIds: ReadonlySet<string>,
  episodeIds: ReadonlySet<string>,
  rerunIds: ReadonlySet<string>,
  /** An app's exposed text inputs: a generated voice's script is bounded by the limit of the input that feeds it. */
  speechTextCaps: ExposedTextCaps | undefined,
  /** The steps already walked: a cycle stops at the fallback. */
  seen: ReadonlySet<string> = new Set(),
): WireLength {
  const gateNodes = listingGateNodes(nodes)
  const gateEdges = listingGateEdges(edges)
  const resolved = resolveGraphOrigin(gateNodes.find((n) => n.id === sourceId), gateNodes, gateEdges)
  if (!resolved) return undefined
  // A wired Settings input (Duration, Provider) is part of what the run generates and charges
  // with, exactly as the node's own estimate reads it.
  const origin = withWiredSettings(resolved, gateNodes, gateEdges)
  if (isRenderNodeType(origin.type)) {
    const render = resolveApplyEdlEstimateLength(origin, gateNodes, gateEdges, rerunIds)
    return { fixedSec: render.fixedMinutes * 60, perEpisodeSec: render.perEpisodeMinute * 60 }
  }
  if (RECORDING_SOURCE_TYPES.has(origin.type ?? "")) {
    if (episodeIds.has(origin.id)) return { fixedSec: 0, perEpisodeSec: 60 }
    if (replacedMediaIds.has(origin.id)) return "unknown"
    const known = mediaLengthSecOf(origin.data as Record<string, unknown> | undefined)
    // A link the user cannot replace and that carries no length (it is read at download): no bound.
    return known === undefined ? (origin.type === "youtube-video" ? "unknown" : undefined) : { fixedSec: known, perEpisodeSec: 0 }
  }
  // A generated voice: the length its script takes, when the listing can read the script.
  if (SPEECH_NODE_TYPES.has(origin.type ?? "")) {
    const ctx = upstreamSpeechText(origin, nodes, edges, speechTextCaps ?? {})
    const script = speechEstimateChars(origin.type as string, origin.data ?? {}, ctx)
    // A script an LLM node writes at run time: at most what that node can write (decided 2026-10-07).
    const llmChars = script.exact ? undefined : llmScriptChars(origin.type as string, origin.data ?? {}, ctx)
    return generatedVoiceLength({ ...script, ...(llmChars !== undefined ? { chars: llmChars, bounded: true } : {}), ...speechScriptTraits(origin.type as string, origin.data ?? {}, ctx) })
  }
  if (seen.has(origin.id)) return undefined
  const walked = new Set(seen).add(origin.id)
  const inputs: WireInput[] = gateEdges
    .filter((e) => e.target === origin.id)
    .map((e) => ({
      sourceId: e.source,
      handle: e.targetHandle,
      kind: wireKindOf(resolveGraphOrigin(gateNodes.find((n) => n.id === e.source), gateNodes, gateEdges)?.type),
      length: wireInputLength(e.source, nodes, edges, replacedMediaIds, episodeIds, rerunIds, speechTextCaps, walked),
    }))
  const length = videoOutputLength(origin, inputs)
  return length === "no-rule" ? undefined : length
}

/**
 * A length-priced utility's listed parts (decided 2026-10-07), from the same
 * estimator its run is charged with, evaluated at the length each input wire
 * has (`wireInputLength`; a wire the listing knows no length for at the
 * estimators' fallback, as in a run estimate): fixed = the price of an episode of no length; per
 * minute = the steepest rise per minute over 1..180 minutes, so the listing at
 * any length is never below the charge (each estimator only grows with its
 * input). Video SFX on any recording the user replaces is the exception: a
 * run refuses a clip over 5 minutes, so it is listed at its 300-second row,
 * fixed (decided 2026-10-07). `undefined` when no input's length is known to
 * the listing: the caller prices the node as a run estimate does.
 */
function utilityListingParts(
  node: EstimateNode,
  nodes: ReadonlyArray<EstimateNode>,
  edges: ReadonlyArray<EstimateEdge>,
  prices: ChargedPriceTable,
  replacedMediaIds: ReadonlySet<string>,
  rerunIds: ReadonlySet<string>,
  speechTextCaps: ExposedTextCaps | undefined,
): ListingParts | undefined {
  const incoming = edges.filter((e) => e.target === node.id)
  const episodeIds = episodeRecordingIds(nodes, edges, replacedMediaIds)
  const wires = incoming.map((e) => wireInputLength(e.source, nodes, edges, replacedMediaIds, episodeIds, rerunIds, speechTextCaps))
  const videoWire = incoming.findIndex((e) => e.targetHandle === "video")
  const videoSfxWire = videoWire >= 0 ? wires[videoWire] : wires.find((l) => l !== undefined)
  // Video SFX refuses a clip over 300 s, so on a recording the user replaces —
  // the episode or any other — its 300-second row is the most any run is
  // charged: listed as that row, fixed (decided 2026-10-07).
  if (node.type === "video-sfx" && (videoSfxWire === "unknown" || (knownLength(videoSfxWire)?.perEpisodeSec ?? 0) > 0)) {
    const maxId = videoSfxCreditId(VIDEO_SFX_PRICING.MAX_DURATION_SEC)
    const maxBase = prices.base(maxId)
    return maxBase === undefined ? undefined : { fixed: prices.charge(maxId, maxBase), perMinute: 0 }
  }
  const lengths = wires.map(knownLength)
  if (lengths.every((l) => l === undefined)) return undefined
  const videoSfxLength = knownLength(videoSfxWire)
  const secAt = (l: InputLength | undefined, minutes: number) => (l ? l.fixedSec + l.perEpisodeSec * minutes : undefined)
  // The base price of a run when the episode is `minutes` long, and the id it is charged at.
  const priceAt = (minutes: number): { id: string; base: number } | undefined => {
    if (node.type === "video-sfx") {
      // The length is the video wire's, not the first wire's: Video SFX also
      // takes a prompt and a negative prompt (inputs prompt, negative, video).
      const sec = secAt(videoSfxLength, minutes)
      const id = videoSfxCreditId(sec === undefined ? undefined : Math.min(sec, VIDEO_SFX_PRICING.MAX_DURATION_SEC))
      const base = prices.base(id)
      return base === undefined ? undefined : { id, base }
    }
    const body = videoUtilityEstimateBody(node, edges)
    if (!body) return undefined
    const base = videoUtilityBaseCredits(node.type, withUpstreamLengths(node.type, body, lengths.map((l) => secAt(l, minutes))))
    return base === undefined ? undefined : { id: node.type, base }
  }
  const zero = priceAt(0)
  if (!zero) return undefined
  const perEpisode = lengths.some((l) => (l?.perEpisodeSec ?? 0) > 0)
  if (!perEpisode) return { fixed: prices.charge(zero.id, zero.base), perMinute: 0 }
  let rate = 0
  let chargeId = zero.id
  for (let m = 1; m <= EDIT_PLAN_MAX_MINUTES; m++) {
    const at = priceAt(m)
    if (!at) return undefined
    rate = Math.max(rate, Math.ceil((at.base - zero.base) / m))
    chargeId = at.id
  }
  return { fixed: prices.charge(zero.id, zero.base), perMinute: rate > 0 ? prices.charge(chargeId, rate) : 0 }
}

/**
 * The part of a node's listed price that follows the episode's length, when
 * the episode is not known: an Apply EDL render whose length is per minute of
 * it (`resolveApplyEdlEstimateLength`), an Edit Plan whose source length is
 * unknown. `undefined` for every other node, and for these once the length is
 * known: the caller prices it fixed, as a run estimate would.
 */
function lengthDependentParts(
  node: EstimateNode,
  nodes: ReadonlyArray<EstimateNode>,
  edges: ReadonlyArray<EstimateEdge>,
  prices: ChargedPriceTable,
  rerunIds: ReadonlySet<string>,
  replacedMediaIds: ReadonlySet<string> = new Set(),
  speechTextCaps?: ExposedTextCaps,
): ListingParts | undefined {
  if (!node.id) return undefined
  const self = { id: node.id, type: node.type, data: node.data }
  if (LENGTH_PRICED_UTILITY_TYPES.has(node.type)) return utilityListingParts(node, nodes, edges, prices, replacedMediaIds, rerunIds, speechTextCaps)
  if (node.type === "apply-edl") {
    const length = resolveApplyEdlEstimateLength(self, listingGateNodes(nodes), listingGateEdges(edges), rerunIds)
    if (length.perEpisodeMinute === 0) return undefined
    const id = getNodeModelIdentifier(withWiredSettings(node, nodes, edges))
    const perMinute = chargedCredits(prices, id, length.perEpisodeMinute)
    if (perMinute === undefined) return undefined
    return { fixed: length.fixedMinutes > 0 ? chargedCredits(prices, id, length.fixedMinutes) ?? 0 : 0, perMinute }
  }
  if (node.type === "edit-plan") {
    if (resolveEditPlanEpisodeSec(self, listingGateNodes(nodes), listingGateEdges(edges)) !== undefined) return undefined
    const data = withWiredSettings(node, nodes, edges).data ?? {}
    return editPlanListingParts(prices, String(data.mode ?? ""), String(data.planTier ?? ""))
  }
  return undefined
}

/**
 * The listed parts of the nodes `include` keeps: each node's fixed and
 * per-minute credits, times every run the node makes (`nodeFanOut`, the
 * editor's own rule: a clips plan's clips, a List's items, a Content Ideas'
 * ideas and other Each wires, times the Repeat count), each of several
 * providers at its own price (decided 2026-10-07).
 *
 * A List the app's user fills lists a price per further item, and Trim /
 * Loop / Combine Videos / Video SFX on the episode recording, a render's
 * output, or the output of ANY other video producer list by its length
 * (`utilityListingParts`; each producer's own rule, `VIDEO_OUTPUT_LENGTH_RULES`
 * in lib/video-output-length.ts, pinned by video-output-length.test.ts for every
 * member of `VIDEO_PRODUCER_TYPES`). What still lists below the charge is a
 * length-priced step on a video the listing cannot bound: a second recording
 * the user replaces, such as an intro card, and the producers
 * `UNBOUNDED_LENGTH_REASONS` names (Video SFX on any of them: the 300-second
 * row). The public "never quotes less" sentences name them (pinned by
 * listing-fan-outs.test.ts and listing-length-priced-utilities.test.ts).
 */
function sumListingParts(
  nodes: ReadonlyArray<EstimateNode>,
  edges: ReadonlyArray<EstimateEdge>,
  prices: ChargedPriceTable,
  include: (node: EstimateNode) => boolean,
  rerunIds: ReadonlySet<string>,
  speechTextCaps: ExposedTextCaps | undefined,
  /** Sources whose recording the app user or the cloner replaces: priced with no length. */
  replacedMediaIds: ReadonlySet<string>,
): ListingParts {
  const gateNodes = listingGateNodes(nodes)
  const gateEdges = listingGateEdges(edges)
  // The graph the length rules read: a replaced source's sample length removed
  // (`withoutMediaLength`), so a render or plan that follows it lists per minute.
  const lengthNodes = nodes.map((n) => (n.id && replacedMediaIds.has(n.id) ? { ...n, data: withoutMediaLength(n.data) } : n))
  const wireSec = runWireLengthOf(lengthNodes, edges, rerunIds)
  return nodes.reduce<ListingParts>((sum, node, i) => {
    if (!include(node)) return sum
    const runs = nodeFanOut({ id: node.id ?? "", type: node.type, data: node.data }, gateNodes, gateEdges, rerunIds)
    if (runs === 0) return sum
    const unitsOf = (n: EstimateNode) => graphPricingUnits(n, lengthNodes, edges, rerunIds)
    // Several providers on one node: each runs, at its own price (the run's
    // expansion), as the run estimate and the editor's estimate sum them.
    const parts = lengthDependentParts(lengthNodes[i]!, lengthNodes, edges, prices, rerunIds, replacedMediaIds, speechTextCaps) ?? {
      fixed: oneRunCredits(node, nodes, edges, prices, speechTextCaps, unitsOf, wireSec),
      perMinute: 0,
    }
    return { fixed: sum.fixed + parts.fixed * runs, perMinute: sum.perMinute + parts.perMinute * runs }
  }, NO_PARTS)
}

/**
 * How many of its price row an estimate quotes a node at, in its graph: an
 * Apply EDL render at the minutes it will render (`resolveApplyEdlEstimateMinutes`,
 * `@nodaro/render-rules` — the one rule the editor's estimate reads too,
 * decided 2026-10-07), every other node as `estimatePricingUnits` does. The
 * run estimate (`sumEstimatedNodes`) and the listing (`sumListingParts`)
 * both read it. Before this the run estimate priced every render at the
 * one-minute floor, under the editor's estimate of the same graph (a Trailer
 * at 2 minutes, a Tighten of an episode of unknown length at the 180-minute
 * ceiling), so a precheck could pass a run whose render reserve was refused.
 *
 * `rerunIds` are the nodes the priced run executes: a plan among them
 * re-plans, so its mode decides the length (an unknown episode at the
 * 180-minute cap); a saved plan outside them hands on its own length, which
 * is exact. A render with no id cannot be placed in the graph and quotes the
 * ceiling — never under-quote.
 *
 * These are the render's minutes at the 180-minute cap; the listing itself
 * lists a length that follows the episode per minute (`lengthDependentParts`).
 * Both estimates multiply by the runs a node makes (`nodeFanOut`).
 */
export function graphPricingUnits(
  node: EstimateNode,
  nodes: ReadonlyArray<EstimateNode>,
  /** Undefined when the caller sent no wiring: unknown, so never the one-minute floor. */
  edges: ReadonlyArray<EstimateEdge> | undefined,
  rerunIds: ReadonlySet<string>,
): number {
  if (node.type !== "apply-edl") return estimatePricingUnits(withWiredSettings(node, nodes, edges ?? []))
  if (!node.id) return EDIT_PLAN_MAX_MINUTES
  // No wiring sent (the route's `edges` omitted): the render may be wired to
  // an episode-long edit, so it quotes the ceiling unless its own inline EDL
  // gives a length — "unknown → the pricier answer", as an add-captions'
  // timed-source check reads it. `[]` is a real answer: nothing wired.
  if (edges === undefined) return inlineEdlMinutes(node.data) ?? EDIT_PLAN_MAX_MINUTES
  return resolveApplyEdlEstimateMinutes({ id: node.id, type: node.type, data: node.data }, listingGateNodes(nodes), listingGateEdges(edges), rerunIds)
}

/**
 * The UGC part of a graph that has a UGC Clip (Cloud only), with the nodes its
 * figure already counts — every caller of the per-node sum skips them, the run
 * estimate and the listing alike. `null` when there is none.
 */
async function ugcPartOf(
  nodes: ReadonlyArray<EstimateNode>,
  edges: ReadonlyArray<EstimateEdge> | undefined,
): Promise<{ credits: number; skip: (node: EstimateNode) => boolean } | null> {
  if (!hasCredits() || !nodes.some((n) => n.type === "ugc-clip")) return null
  const ugc = await estimateUgcPart(nodes, edges)
  return {
    credits: ugc.credits,
    skip: (n) => UGC_NODE_TYPES.has(n.type) || (n.id !== undefined && ugc.downstream.has(n.id)),
  }
}

/** Nodes a UGC estimate already prices as its fixed lines, when they sit downstream of UGC Clip. */
const UGC_DOWNSTREAM_TYPES: ReadonlySet<string> = new Set(["combine-videos", "video-overlay", "add-captions"])

/**
 * The UGC part of a graph, priced through the plugin seam with no payer
 * (`ESTIMATE_CALLER`): the same figure for every caller of `estimateWorkflowCredits`.
 * A node with no `id`, or a call with no edges, cannot be shown to be downstream
 * and is counted by the per-node sum (over-quote, never under-quote).
 */
async function estimateUgcPart(
  nodes: ReadonlyArray<EstimateNode>,
  edges: ReadonlyArray<EstimateEdge> | undefined,
): Promise<{ credits: number; downstream: ReadonlySet<string> }> {
  const typeById = new Map(nodes.filter((n) => n.id !== undefined).map((n) => [n.id!, n.type] as const))
  const reached = new Set<string>()
  const queue = nodes.filter((n) => n.type === "ugc-clip" && n.id !== undefined).map((n) => n.id!)
  while (queue.length > 0) {
    const id = queue.shift()!
    for (const e of edges ?? []) {
      if (e.source !== id || reached.has(e.target)) continue
      reached.add(e.target)
      queue.push(e.target)
    }
  }
  const downstream = new Set([...reached].filter((id) => UGC_DOWNSTREAM_TYPES.has(typeById.get(id) ?? "")))
  try {
    // ee -> ee, dynamic only so that this module's graph does not load the quote module on every import.
    const { estimateUgcRun, ugcEstimateInputOf } = await import("../lib/ugc-estimate.js")
    const { ESTIMATE_CALLER } = await import("../lib/ugc-quote.js")
    const r = await estimateUgcRun(ESTIMATE_CALLER, ugcEstimateInputOf(nodes, edges))
    return { credits: r.expected, downstream }
  } catch (err) {
    console.warn("[estimate] UGC estimate unavailable; UGC nodes counted as 0", err instanceof Error ? err.message : err)
    return { credits: 0, downstream }
  }
}

const listingGateNodes = (nodes: ReadonlyArray<EstimateNode>) =>
  nodes.flatMap((n) => (n.id ? [{ id: n.id, type: n.type, data: n.data, parentId: n.parentId }] : []))
const listingGateEdges = (edges: ReadonlyArray<EstimateEdge>) =>
  edges.flatMap((e) =>
    e.source ? [{ source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle, data: e.data }] : [],
  )

/**
 * The listing's two parts (`AppListingEstimate`), an upper bound whatever the
 * stop rule's flag says (the listing never asks it). The preview part is the
 * whole graph at its saved settings. Each render the run executes at Preview
 * has its Render final: the render's whole Render final set
 * (`renderFinalRunSet`, what the app runner's Render final runs) with the
 * render at Final and every other render at its saved settings — never cut
 * short at a later render still at Preview. With the flag off a final does
 * not stop there, and the runner's card offers Render final on every render
 * whose take is a Preview, so a node after two Preview renders (in a chain,
 * or fed by both) runs in each of their finals and is priced in each (review
 * round 3, decided 2026-10-06). With the flag on a final stops at a later
 * Preview and that node runs once; the listing then over-quotes by it
 * (accepted; revisit when production turns the flag on).
 */
function listingEstimate(
  nodes: ReadonlyArray<EstimateNode>,
  edges: ReadonlyArray<EstimateEdge>,
  prices: ChargedPriceTable,
  publishType: ListingPublishType,
  /** Nodes priced elsewhere (the UGC seam): read as part of the graph, never summed. */
  skip?: (node: EstimateNode) => boolean,
  /** The app's exposed text inputs: an exposed speech text is a ceiling, not the placeholder. */
  speechTextCaps?: ExposedTextCaps,
  /** An app's or component's exposed media inputs (`exposedMediaNodeIds`). A
   *  template, and a call without them, replaces every upload node: never under-quote. */
  replaceableMediaNodeIds?: ReadonlySet<string>,
  /** An app's or component's List inputs its user fills (`exposedListNodeIds`). */
  exposedListNodeIds?: ReadonlySet<string>,
): AppListingEstimate {
  const parts = listingParts(nodes, edges, prices, publishType, skip, speechTextCaps, replaceableMediaNodeIds)
  if (publishType === "template" || !exposedListNodeIds?.size) return parts
  // A List the app's user fills (decided 2026-10-07): the saved items are in
  // the parts above; each further item is priced as the difference one more
  // item makes, past at least one item (an empty List runs its fan-out once).
  // Several such Lists list the largest — never below any one's item.
  let previewPerItem = 0
  let finalPerItem = 0
  for (const listId of exposedListNodeIds) {
    const list = nodes.find((n) => n.id === listId)
    if (!list || list.type !== "list") continue
    const saved = Math.max(1, listItemCount(list.data))
    const withItems = (count: number) => nodes.map((n) => (n.id === listId ? { ...n, data: withListItemCount(n.data, count) } : n))
    const one = listingParts(withItems(saved), edges, prices, publishType, skip, speechTextCaps, replaceableMediaNodeIds)
    const two = listingParts(withItems(saved + 1), edges, prices, publishType, skip, speechTextCaps, replaceableMediaNodeIds)
    const ceiling = (fixed: number, perMinute: number) => fixed + perMinute * EDIT_PLAN_MAX_MINUTES
    previewPerItem = Math.max(previewPerItem, ceiling(two.preview, two.previewPerMinute) - ceiling(one.preview, one.previewPerMinute))
    finalPerItem = Math.max(finalPerItem, ceiling(two.final, two.finalPerMinute) - ceiling(one.final, one.finalPerMinute))
  }
  return previewPerItem > 0 || finalPerItem > 0 ? { ...parts, previewPerItem, finalPerItem } : parts
}

/** A List's items as a run iterates them (its one column, newline-separated), else its rows. */
function listItemCount(data: Record<string, unknown> | undefined): number {
  const items = typeof data?.items === "string" ? data.items.split("\n").map((x) => x.trim()).filter(Boolean) : []
  if (items.length > 0) return items.length
  return Array.isArray(data?.rows) ? data.rows.length : 0
}

/** A List's data holding `count` items: its own, then copies of its last (or a placeholder). */
function withListItemCount(data: Record<string, unknown> | undefined, count: number): Record<string, unknown> {
  const d = data ?? {}
  const items = typeof d.items === "string" ? d.items.split("\n").map((x) => x.trim()).filter(Boolean) : []
  if (items.length === 0 && Array.isArray(d.rows) && d.rows.length > 0) {
    const rows = d.rows as unknown[]
    return { ...d, rows: Array.from({ length: count }, (_, i) => rows[Math.min(i, rows.length - 1)]) }
  }
  return { ...d, items: Array.from({ length: count }, (_, i) => items[i] ?? items[items.length - 1] ?? `item ${i + 1}`).join("\n") }
}

/** The listing's parts for the graph as saved (see `listingEstimate`). */
function listingParts(
  nodes: ReadonlyArray<EstimateNode>,
  edges: ReadonlyArray<EstimateEdge>,
  prices: ChargedPriceTable,
  publishType: ListingPublishType,
  skip?: (node: EstimateNode) => boolean,
  speechTextCaps?: ExposedTextCaps,
  replaceableMediaNodeIds?: ReadonlySet<string>,
): AppListingEstimate {
  // The recordings an app user or a template's cloner replaces with their own
  // (review F2, decided 2026-10-07): the creator's sample length is not theirs.
  const replaced = publishType !== "template" && replaceableMediaNodeIds ? replaceableMediaNodeIds : exposedMediaNodeIds(null, nodes)
  const frozen = (n: EstimateNode) => (n.data as { skipped?: unknown } | undefined)?.skipped === true
  // The run a listing prices re-runs every node but a frozen one, which hands
  // on what it holds. A plan re-plans on the run's own recording in the
  // preview part AND in each Render final (review F1, decided 2026-10-07): an
  // app's Render final renders the plan the app user's Preview run just made,
  // never the creator's saved one.
  const reruns = new Set(nodes.flatMap((n) => (n.id && !frozen(n) ? [n.id] : [])))
  // The preview part is the whole graph at its saved settings — never only
  // the run up to each Preview: a flag-off app run executes all of it, with
  // the fee (see AppListingEstimate). Revisit when production turns the flag on.
  const preview = sumListingParts(nodes, edges, prices, (n) => !skip?.(n), reruns, speechTextCaps, replaced)
  // A component runs inside its caller's run and never stops at a Preview.
  if (publishType === "component") return { preview: preview.fixed, final: 0, previewPerMinute: preview.perMinute, finalPerMinute: 0 }
  const gateNodes = listingGateNodes(nodes)
  const gateEdges = listingGateEdges(edges)
  let final = NO_PARTS
  // Every render the run executes at Preview (gated or not: with the flag off
  // a run executes them all, and each take is offered its Render final).
  for (const renderId of previewStopsForListing(gateNodes, gateEdges).previewRenderIds) {
    const runSet = renderFinalRunSet(renderId, gateNodes, gateEdges)
    const atFinal = nodes.map((n) => (n.id === renderId ? { ...n, data: { ...(n.data ?? {}), quality: "final" } } : n))
    const parts = sumListingParts(atFinal, edges, prices, (n) => !!n.id && runSet.has(n.id) && !frozen(n) && !skip?.(n), reruns, speechTextCaps, replaced)
    final = { fixed: final.fixed + parts.fixed, perMinute: final.perMinute + parts.perMinute }
  }
  return { preview: preview.fixed, final: final.fixed, previewPerMinute: preview.perMinute, finalPerMinute: final.perMinute }
}

/**
 * How many of its price row a node's run is charged: the seconds an LTX 2.3
 * Pro extend adds (its row is per second — the same product the route's guard
 * and the workflow run reserve, lib/ltx-extend-credits.ts), else one.
 */
function estimatePricingUnits(node: EstimateNode): number {
  const data = node.data ?? {}
  if (node.type === "extend-video" && data.provider === "ltx-2.3-pro") return ltxExtendDurationSec(data.duration)
  // Video Retake: the seconds of the replaced window (lib/ltx-retake-credits.ts).
  if (node.type === "video-retake") return ltxRetakeDurationSec(data.retakeDuration)
  return 1
}

/**
 * Compute composite model identifier from a workflow node for credit estimation.
 * Mirrors frontend getModelIdentifier() in config-panels/helpers.ts.
 */
/** The shape `estimateWorkflowCredits` reads a node in. Exported so every caller
 *  passes the estimator's OWN type instead of re-declaring a structural copy at
 *  the call site — a copy cannot be widened (an `id`, an `edges` parameter)
 *  without someone noticing every place that still omits it. */
export type EstimateNode = { id?: string; type: string; data?: Record<string, unknown>; parentId?: string | null }
/** Ditto for an edge: the fields a price can depend on, and those the preview
 *  stop rule follows (`sourceHandle`, `data.outputMode`). */
export type EstimateEdge = { source?: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; data?: unknown }

/**
 * Does an edge feed this add-captions node a TIMED caption source — a Transcript
 * on its `transcript` handle, or a transcribe node wired straight in? That makes
 * the render Remotion (add-captions:kinetic) whatever the node's own data says.
 * UNKNOWN (no edges passed, or a node without an id) answers TRUE: the estimate
 * may over-quote, it must never under-quote.
 */
function timedCaptionSourceWired(node: EstimateNode, nodes: ReadonlyArray<EstimateNode>, edges?: ReadonlyArray<EstimateEdge>): boolean {
  if (node.type !== "add-captions") return false
  if (!edges || !node.id) return true
  const typeById = new Map(nodes.map((n) => [n.id, n.type]))
  return edges.some(
    (e) => e.target === node.id && (e.targetHandle === "transcript" || typeById.get(e.source ?? "") === "transcribe"),
  )
}

/**
 * How many distinct upstream nodes feed this audio-sync node's `sources`
 * handle — the count its price is read at (`audio-sync:<n>src`). UNKNOWN (no
 * edges passed, or a node without an id) answers NaN, which
 * `audioSyncCreditId` reads as the 6-source ceiling: the estimate may
 * over-quote, it must never under-quote. Distinct by source node, because the
 * source node id IS the audio-sync source id (the run keeps one row per node).
 */
function audioSyncWiredSourceCount(node: EstimateNode, edges?: ReadonlyArray<EstimateEdge>): number | undefined {
  if (node.type !== "audio-sync") return undefined
  if (!edges || !node.id) return Number.NaN
  const sources = new Set<string>()
  let anonymous = 0
  for (const e of edges) {
    if (e.target !== node.id || e.targetHandle !== "sources") continue
    if (e.source) sources.add(e.source)
    else anonymous++
  }
  return sources.size + anonymous
}

function getNodeModelIdentifier(
  node: EstimateNode,
  graph: {
    timedCaptionSourceWired?: boolean
    audioSyncSourceCount?: number
    /** Edit Plan: the master source's known length (undefined = unknown) and
     *  whether the run is charged per started minute (decided 2026-10-07). */
    editPlan?: { readonly sourceSec: number | undefined; readonly perMinute: boolean }
    /** Video SFX: the input clip's length a run estimate knows (undefined = an unmeasured clip). */
    videoSfxSec?: number
  } = {},
): string {
  const nodeType = node.type
  const data = node.data ?? {}

  // Audio Sync: priced per source aligned to the reference — a GRAPH fact (how
  // many recordings are wired into `sources`), counted by the caller from the
  // edges. No count (no graph context) → the 6-source ceiling. The same builder
  // the route and the payload builder reserve through.
  if (nodeType === "audio-sync") return audioSyncCreditId(graph.audioSyncSourceCount ?? Number.NaN)

  // Edit Plan: mode × tier × duration bucket, the same id the run reserves
  // (payload-builder). The node has no `provider`, so without this branch it fell
  // through to the bare `edit-plan` id — the table MAXIMUM (premium clips, 180m)
  // whatever it runs. No recording length is known here → the node's own
  // mode × tier at the ceiling bucket: never under the reservation. Mirrors the
  // editor's getModelIdentifier.
  //
  // With the graph (decided 2026-10-07): the master source's known length, in
  // started minutes when the plugin charges per started minute, else the step
  // it rounds up to — the id the run reserves for that source
  // (`editPlanReserveCreditId`, the same builder the reserve and the editor use).
  if (nodeType === "edit-plan") {
    return editPlanReserveCreditId(asEditPlanMode(data.mode), asEditPlanTier(data.planTier), graph.editPlan?.sourceSec, graph.editPlan?.perMinute === true)
  }

  // AI Writer always uses "ai-writer"
  if (nodeType === "ai-writer") return "ai-writer"

  // Generate Music reserves on the music id whatever the model (the route and
  // the payload builder both do); the model id "minimax" is the MiniMax VIDEO price.
  if (nodeType === "generate-music") return MUSIC_CREDIT_ID

  // Video Composer reserves on the scene-graph-ai rows (its route builds the
  // id from the same three levers), not on the video-composer ones.
  if (nodeType === "video-composer") {
    return buildLlmCreditIdentifier("scene-graph-ai", data.llmModel as string | undefined, data.reasoningEffort as string | undefined, data.advancedMode === true)
  }

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

  // Content Recipe / Content Ideas: the same ids the plugin route and the
  // orchestrator reserve — the EFFECTIVE model's tier (an unset model is the
  // economy default, never the bare id) and, for ideas, the count bucket.
  if (nodeType === "content-recipe") {
    return contentRecipeCreditId(data.llmModel, data.reasoningEffort as string | undefined)
  }
  if (nodeType === "content-ideas") {
    return contentIdeasCreditId(data.count, data.llmModel, data.reasoningEffort as string | undefined)
  }

  // Suno: the ROUTE contract decides which operations are version-priced.
  // `sunoCreditType` gates on the operation, so passing the node type (which
  // IS the operation key) is correct for every Suno node — version-priced ones
  // get suno-v5/suno-v5_5, flat ones get their own key back. suno-separate is
  // excluded because its own branch below is a different axis (stem vs vocal).
  if (nodeType.startsWith("suno-") && nodeType !== "suno-separate") {
    return sunoCreditType(data.model as string | undefined, nodeType)
  }

  // Suno separate: "split_stem" costs more
  if (nodeType === "suno-separate") {
    return (data.type as string) === "split_stem" ? "suno-separate-stem" : "suno-separate"
  }

  // Audio separation (Demucs): "best" quality costs more
  if (nodeType === "audio-separation") {
    return (data.quality as string) === "best" ? "audio-separation:best" : "audio-separation"
  }

  // Meta Ads scraper: 1 credit per requested ad, tiered on count × sources —
  // the same builder the route's guard + reservation use, so the pre-run
  // estimate never under-quotes a multi-page scrape (page urls are stored one
  // per line on the node).
  if (nodeType === "meta-ads-scrape") {
    // ONE identifier (packages/shared) from count × sources × analysis, the
    // same builder the route's guard + reservation use — this quote can never
    // say one source (or no analysis) while the reservation bills otherwise.
    return metaAdsScrapeCreditIdFromNode(data)
  }

  if (nodeType === "instagram-scrape") {
    return instagramScrapeCreditIdFromNode(data)
  }

  // Social Search: the page count the run reserves (one page per 20 posts) —
  // the same builder the orchestrator's payload and the plugin route use.
  if (nodeType === "social-search") {
    return socialSearchCreditIdFromNode(data)
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

  // Add Captions: the price follows the RENDERER, via the same predicate the
  // route's credit id, payload-builder's reservation and the worker's dispatch
  // all use — a styled / timed / transcribed / segmented caption is a Remotion
  // render (`add-captions:kinetic`), a plain-text subtitle is the cheap FFmpeg
  // burn. Without this branch every caption node quoted the FFmpeg price for a
  // Remotion render. `text` is read from node data only: this pre-execution
  // estimate cannot see a wired upstream text, and an absent/empty `text`
  // correctly yields kinetic — an estimate may OVER-quote, it must never
  // under-quote (it feeds published apps' advertised price).
  if (nodeType === "add-captions") {
    // `text` proves the cheap FFmpeg burn only when it is LITERAL: a `{Label}`
    // reference can resolve to nothing at run time, which flips the render to
    // transcription → Remotion. And a wired timed source (a graph fact this
    // node-only view gets from `graph`) always means Remotion.
    const rawText = typeof data.text === "string" ? data.text : undefined
    const literalText = rawText && !/\{[^{}]+\}/.test(rawText) ? rawText : undefined
    return captionRoutesToRemotion({
      style: (data.captionStyle ?? data.style) as string | undefined,
      text: literalText,
      segments: Array.isArray(data.segments) ? (data.segments as unknown[]) : undefined,
      transcript: graph.timedCaptionSourceWired ? {} : data.transcript,
      captions: Array.isArray(data.captions) ? (data.captions as unknown[]) : undefined,
      look: data.look,
      fontFamily: data.fontFamily,
      fontWeight: data.fontWeight,
      strokeColor: data.strokeColor,
      strokeWidth: data.strokeWidth,
      uppercase: data.uppercase,
      positionY: data.positionY,
      maxWordsPerLine: data.maxWordsPerLine,
    })
      ? "add-captions:kinetic"
      : "add-captions"
  }

  // Transcribe reserves on the ENGINE (payload-builder → DEFAULT_TRANSCRIBE_NODE_PROVIDER
  // when the node names none), never on the bare node-type key — which priced a
  // provider-less node at the generic `transcribe` row while the run reserved the
  // engine's. An estimate may over-quote, never under-quote.
  if (nodeType === "transcribe") {
    return (typeof data.provider === "string" && data.provider) || DEFAULT_TRANSCRIBE_NODE_PROVIDER
  }

  // Video Retake: priced per second of the replaced window — the per-second
  // row, which sumWorkflowEstimate multiplies by the seconds (estimatePricingUnits).
  if (nodeType === "video-retake") return LTX_RETAKE_PER_SECOND_CREDIT_ID

  // Text to Audio: a price row per whole second of requested audio (no
  // duration = 5 s), on the engine the run uses — the default when the node
  // names none. ABOVE the `!provider` bail: a provider-less node reserves on
  // the default engine's row, never the bare node-type fallback.
  if (nodeType === "text-to-audio") return textToAudioCreditId(data.provider as string | undefined, data.duration)

  // Video SFX: a price row per input-clip length, chosen when the run measures
  // the clip. Before a run, a clip whose length the graph tells (a render's
  // output, a chain of length-priced steps) is quoted at that length's row,
  // at most 300 seconds, as the listing lists it (decided 2026-10-07); any
  // other clip at the row for the length an unmeasurable clip is charged
  // (8 seconds).
  if (nodeType === "video-sfx") return videoSfxCreditId(graph.videoSfxSec)

  // Apply EDL: the per-minute row of the render's quality — a preview on
  // `apply-edl:proxy`, a final on `apply-edl` — the id the route and the
  // workflow run reserve on. (Mirrors the frontend getModelIdentifier.)
  if (nodeType === "apply-edl") return applyEdlCreditId(data.quality)

  // Text to Dialogue reserves on its dialogue model's own row — the route's
  // guard and the payload builder both call dialogueProviderOf, so a node with
  // no (or an unknown) provider is quoted as the v3 dialogue it runs as. ABOVE
  // the `!provider` bail, which priced it at the node-type row.
  if (nodeType === "text-to-dialogue") return dialogueProviderOf(data.provider)

  const provider = data.provider as string | undefined
  if (!provider) return nodeType

  // Extend-video: VEO quality costs more than fast
  if (nodeType === "extend-video" && provider === "veo-extend" && data.model === "quality") {
    return "veo-extend:quality"
  }

  // Extend-video: LTX 2.3 Pro is priced per second added — the per-second row,
  // which sumWorkflowEstimate multiplies by the seconds (estimatePricingUnits).
  if (nodeType === "extend-video" && provider === "ltx-2.3-pro") return LTX_EXTEND_PER_SECOND_CREDIT_ID

  // Extend-video: seedance trim-stitch extend prices by duration tier ×
  // resolution, for the model SEEDANCE_EXTEND_GENERATION_MODEL actually
  // dispatches on (the 2.0 rows already include the ffmpeg stitch overhead).
  // The estimate must follow the reservation or the quote lies.
  if (nodeType === "extend-video" && provider === "seedance-2-extend") {
    return buildSeedanceExtendCreditIdentifier(
      data.duration as number | undefined,
      data.resolution as string | undefined,
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

  // Video to Video, Seedance EDIT lane: Seedance has no v2v endpoint, so this
  // lane dispatches a text-to-video job in edit shape and reserves on the
  // reference-video ladder at the model's longest clip. ONE shared builder with
  // the reservation (payload-builder.ts) and both frontend quote sites. The
  // hasVideoRef flag IS known here without seeing the edges — unlike the
  // generic video branch below, the source clip is this node's whole reason to
  // exist, so the edit lane always carries exactly one reference video. Without
  // this branch the estimate falls through to the bare `seedance-2-5` key (the
  // 8s 720p row), under-quoting every longer or higher-resolution edit — and an
  // estimate may over-quote but must NEVER under-quote (it feeds published
  // apps' advertised price).
  if (nodeType === "video-to-video" && isSeedanceVideoEditProvider(provider)) {
    return seedanceVideoEditCreditId(provider, data.v2vResolution as string | undefined)
  }

  // Video nodes with duration/audio-based variable pricing.
  // `resolution` is forwarded so a resolution-priced family (wan-3, seedance-2,
  // happyhorse, ...) is ESTIMATED at the tier the node is configured for.
  // Without it the identifier collapses to the provider's default tier —
  // wan-3-prime at 1080p would quote 320 against a real 630, and the estimate
  // is what a published app advertises. Ignored by every provider with no
  // resolution axis. The reference-video flag is deliberately NOT forwarded:
  // reference videos arrive over EDGES, which this pre-execution estimate
  // cannot see (payload-builder recomputes the identifier at reservation time
  // from the resolved inputs).
  if (nodeType === "image-to-video" || nodeType === "text-to-video") {
    const duration = data.duration as number | string | undefined
    const sound = (data.sound ?? data.kling3Sound) as boolean | undefined
    return buildVideoCreditModelIdentifier(provider, duration, sound, nodeType as "image-to-video" | "text-to-video", (data.videoSize ?? data.mode) as string | undefined, data.resolution as string | undefined)
  }

  // Unified generate-video node — mode dispatch (i2v vs t2v) happens at
  // execution time based on the wiring shape, which the pre-execution
  // estimate doesn't see. Default to the i2v identifier so display estimates
  // reflect the more common path; the runtime reservation in payload-builder
  // computes the correct identifier from the resolved inputs.
  if (nodeType === "generate-video") {
    const duration = data.duration as number | string | undefined
    const sound = (data.sound ?? data.kling3Sound) as boolean | undefined
    return buildVideoCreditModelIdentifier(provider, duration, sound, "image-to-video", (data.videoSize ?? data.mode ?? data.kling3Mode) as string | undefined, data.resolution as string | undefined)
  }

  // Topaz's billed lever is the upscale FACTOR (resolveTopazUpscale); the
  // legacy `targetResolution` on stored node data is mapped forward by the
  // same resolver the route and the worker use, so the estimate the editor
  // shows is the tier that will actually be reserved and rendered.
  if (provider === "topaz-image-upscale") {
    const { creditTier } = resolveTopazUpscale({
      upscaleFactor: data.upscaleFactor as string | undefined,
      targetResolution: data.targetResolution as string | undefined,
    })
    return buildCreditModelIdentifier(provider, undefined, undefined, undefined, creditTier)
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

/** What a run of this workflow will be charged — see `CreditsService.estimateWorkflowCredits`. */
export function estimateWorkflowCredits(
  nodes: ReadonlyArray<EstimateNode>,
  edges?: ReadonlyArray<EstimateEdge>,
  /** A surface that describes an app's inputs BEFORE the user types passes the
   *  exposed text inputs (`speechTextCaps`); a run whose inputs are already
   *  merged onto the nodes passes nothing. */
  options?: WorkflowEstimateOptions,
): Promise<number> {
  return CreditsService.estimateWorkflowCredits(nodes, edges, options)
}

/**
 * What a run of a SUBSET of this workflow will be charged: the nodes in
 * `runNodeIds`, priced on `nodes` (the graph the run executes, its overrides
 * applied) — an agent's Render final quote (decided 2026-10-06).
 */
export function estimateRunSetCredits(
  nodes: ReadonlyArray<EstimateNode>,
  edges: ReadonlyArray<EstimateEdge>,
  runNodeIds: ReadonlySet<string>,
): Promise<number> {
  return CreditsService.estimateWorkflowCredits(nodes, edges, { runNodeIds })
}

/**
 * What a run can spend from a payer's personal pools. In web-free mode the
 * topup pool is excluded — it never spends on a consumer surface. The ONE
 * derivation both the per-model check (`checkCreditsWithProfile`) and the
 * run-set check below read, so the two can never disagree about a balance.
 */
function spendableBalance(
  profile: { subscription_credits?: number | null; topup_credits?: number | null },
  webFree: boolean,
): { subscriptionCredits: number; topupCredits: number; totalBalance: number } {
  const subscriptionCredits = profile.subscription_credits ?? 0
  const topupCredits = webFree ? 0 : (profile.topup_credits ?? 0)
  return { subscriptionCredits, topupCredits, totalBalance: subscriptionCredits + topupCredits }
}

/** Whether a payer can cover a run set — see {@link checkRunSetCredits}. */
export interface RunSetCreditsCheck {
  sufficient: boolean
  required: number
  /**
   * What the payer can spend, for the caller to see. `null` when it is not
   * theirs to see (a deployment payer: the operator's pool stays private, as
   * in the credit guard) or not what pays (a workspace budget, whose headroom
   * is the reservation's to judge).
   */
  available: number | null
  /** Why it is refused; only when `sufficient` is false. */
  message?: string
}

/** The credit guard's own words for it (credit-guard-impl.ts): the operator is the fixer. */
const DEPLOYMENT_OUT_OF_CREDITS = "This deployment is out of credits. Contact your administrator."

/**
 * Can the payer cover a run set priced at `required` credits? Asked BEFORE an
 * execution row exists — an agent's Render final (decided 2026-10-06) — so a
 * run that cannot finish is refused with a 402 rather than started, charged
 * for its first node, and failed at the render's own reservation.
 *
 * Balance only, on the gates the reservation uses (`spendGates`, the payer's
 * profile through `payerProfileId`). Model availability, daily caps and the
 * allowance stay with each node's own preflight in the executor. A workspace
 * payer passes: its budget's ceiling is the reserve RPC's atomic check, as in
 * `checkCreditsWithProfile`. Throws when the payer's profile cannot be read —
 * the caller refuses rather than run unchecked.
 */
export async function checkRunSetCredits(
  userId: string,
  required: number,
  surface: CreditCheckSurface,
): Promise<RunSetCreditsCheck> {
  if (creditsDisabled()) return { sufficient: true, required, available: null }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("tier, subscription_tier, lifetime_topup_credits, subscription_credits, topup_credits")
    .eq("id", payerProfileId(userId, surface.billingContext))
    .single()
  if (error || !profile) throw new Error("The payer's credit profile could not be read")

  const gates = spendGates(effectiveTierOf(profile as CreditProfile), surface)
  if (!gates.personalBalance) return { sufficient: true, required, available: null }

  const { totalBalance } = spendableBalance(profile as CreditProfile, gates.webFree)
  const deployment = surface.billingContext?.payer === "deployment"
  const available = deployment ? null : totalBalance
  if (totalBalance >= required) return { sufficient: true, required, available }
  return {
    sufficient: false,
    required,
    available,
    message: deployment
      ? DEPLOYMENT_OUT_OF_CREDITS
      : gates.webFree
        ? `Your free credits can't cover this run (need ${required}, free pool has ${totalBalance}).`
        : `Insufficient credits. Required: ${required}, Available: ${totalBalance}`,
  }
}

/**
 * The listing STORED at publish — a published app's, component's or
 * template's listed price and an app's `base_estimated_credits`, on every
 * publish and republish — in two parts (`AppListingEstimate`, decided
 * 2026-10-06): the preview part, the whole graph at its saved settings, which
 * the creator's fee applies to; and the final part, each Render final, which
 * it does not (0 for a component). ONE function for every listing: the
 * preview stop rule shapes run estimates only, never the listing (decided
 * 2026-10-05). Every publish path calls this, never `estimateWorkflowCredits`
 * — a guard test (`__tests__/listing-estimate-sites.test.ts`) fails the build
 * otherwise.
 */
export async function estimateWorkflowListingCredits(
  nodes: ReadonlyArray<EstimateNode>,
  edges: ReadonlyArray<EstimateEdge> | undefined,
  options: {
    readonly publishType: ListingPublishType
    /** The app's exposed text inputs (`speechTextCaps`) — a publish path prices
     *  the graph BEFORE the app user's inputs exist, so an exposed speech text
     *  is a ceiling, not the author's placeholder. */
    readonly speechTextCaps?: ExposedTextCaps
    /** An app's or component's exposed media inputs (`exposedMediaNodeIds`):
     *  a recording the app user replaces is priced with no length. A template
     *  replaces every upload node, whatever is passed. */
    readonly replaceableMediaNodeIds?: ReadonlySet<string>
    /** An app's or component's List inputs (`exposedListNodeIds`): priced per
     *  further item beyond the saved count. Ignored for a template. */
    readonly exposedListNodeIds?: ReadonlySet<string>
  },
): Promise<AppListingEstimate> {
  const prices = hasCredits() ? await getChargedPriceTable() : STATIC_BASE_PRICES
  // The UGC part is priced through its seam, in the preview part (it is the app run's).
  const ugc = await ugcPartOf(nodes, edges)
  const split = listingEstimate(nodes, edges ?? [], prices, options.publishType, ugc?.skip, options.speechTextCaps, options.replaceableMediaNodeIds, options.exposedListNodeIds)
  return { ...split, preview: split.preview + (ugc?.credits ?? 0) }
}
