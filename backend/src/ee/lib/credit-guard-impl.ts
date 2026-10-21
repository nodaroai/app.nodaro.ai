// Heavy implementation of creditGuard + reserveCreditsForJob.
// Loaded dynamically by ../../middleware/credit-guard.ts only when hasCredits()
// is true. This keeps community/business builds free of any credit-system code
// at runtime.

import type { FastifyRequest, FastifyReply } from "fastify"
import { CreditsService, PriceNotConfiguredError, getModelCreditCostFromDB, checkRunSetCredits, DEPLOYMENT_OUT_OF_CREDITS, type ReserveResult, type CreditProfile, type StorageProfile } from "../billing/credits.js"
import { supabase } from "../../lib/supabase.js"
import { warmAdminCache } from "../../lib/admin-check.js"
import { getAppSettings } from "../../lib/app-settings.js"
import type { CreditReservation, StorageSnapshot, CreditGuardOpts, PayerAffordability } from "../../middleware/credit-guard.js"
import { resolveEffectiveTier } from "@nodaro/shared/credits"
import { isWebFreeModeCandidate, sendSubscriptionRequired, SUBSCRIPTION_REQUIRED_BODY } from "./payg-surface-guard.js"
import { freeVideoRequestOf, readsVideoBody } from "../billing/free-video-limits.js"
import { applyServiceMarkup } from "../billing/service-margin.js"
import { payerProfileId } from "../billing/org-entitlements.js"
import { refundReservedCreditsForJob } from "../../lib/credits-job-lifecycle.js"
import { ReserveRpcError, mapReserveError, reserveRefusalFor } from "../../lib/reserve-errors.js"
import { billingService, type BillingContext } from "../../lib/billing-context.js"
import { allowanceEnforcementActive, deploymentBillingContext, deploymentPayerActive } from "../../lib/deployment-payer.js"
import { allowanceFor } from "../billing/deployment-allowance-service.js"
import { getWelcomeOfferConfig } from "./welcome-offer-config.js"
import { consentBlockExempt, sendConsentRequired } from "./welcome-consent-gate.js"

/** 403 body code when an extension-granted account has not consented yet. */
export { CONSENT_REQUIRED_CODE } from "./consent-required.js"

/** The one profile read the guard makes; the welcome-offer column is appended
 *  only while the offer is on (it exists only from migration 426). */
const GUARD_PROFILE_COLUMNS =
  "role, tier, subscription_tier, lifetime_topup_credits, subscription_credits, topup_credits, daily_spent_credits, last_daily_reset, storage_used_bytes, storage_limit_bytes"

interface GuardProfileRow extends CreditProfile, StorageProfile {
  role?: string | null
  welcome_consent_pending?: boolean | null
}

// Per-instance monthly spend rollup for the community-connect cap. Reads the
// jobs ledger (source_detail carries the appId — stamped by insertJob) with a
// 60s in-process cache so the guard adds at most one extra query per minute
// per instance. Failure is fail-open: the cap is containment, not billing.
const instanceSpendCache = new Map<string, { value: number; expires: number }>()

async function monthlyInstanceSpend(userId: string, appId: string): Promise<number> {
  const key = `${userId}:${appId}`
  const hit = instanceSpendCache.get(key)
  if (hit && hit.expires > Date.now()) return hit.value
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  try {
    const { data } = await supabase
      .from("jobs")
      .select("credits")
      .eq("user_id", userId)
      .eq("source", "app")
      .eq("source_detail", appId)
      .gte("created_at", monthStart.toISOString())
    const total = (data ?? []).reduce((sum, row) => sum + ((row as { credits: number | null }).credits ?? 0), 0)
    instanceSpendCache.set(key, { value: total, expires: Date.now() + 60_000 })
    return total
  } catch {
    return 0
  }
}

// 503 is right: the route exists and the request is valid, but the system
// cannot serve it because pricing is unconfigured. Not 400 (client is fine);
// not 500 (system is functioning, just missing a config row).
export const PRICE_NOT_CONFIGURED_CODE = "price_not_configured"

export function handlePriceNotConfigured(
  err: unknown,
  reply: FastifyReply,
  routeName: string,
): boolean {
  if (!(err instanceof PriceNotConfiguredError)) return false
  console.error(
    `[credit-guard] ${routeName}: missing price for "${err.modelIdentifier}"`,
  )
  reply.status(503).send({
    error: {
      code: PRICE_NOT_CONFIGURED_CODE,
      message:
        `Pricing is not configured for "${err.modelIdentifier}". ` +
        `The operator must add a model_pricing row or STATIC_CREDIT_COSTS entry.`,
      identifier: err.modelIdentifier,
    },
  })
  return true
}

/**
 * What a batch of jobs is charged: the sum of each job's own price, each
 * through `getModelCreditCostFromDB` — the lookup `reserveCredits` prices a
 * job from when no override is set — so the pre-flight is the exact sum of
 * the reservations that follow. One lookup per distinct identifier.
 */
async function chargedBatchTotal(identifiers: readonly string[]): Promise<number> {
  const priced = new Map<string, number>()
  let total = 0
  for (const id of identifiers) {
    let credits = priced.get(id)
    if (credits === undefined) {
      credits = (await getModelCreditCostFromDB(id)).creditCost
      priced.set(id, credits)
    }
    total += credits
  }
  return total
}

/**
 * The post-markup credits a route's `computeCredits` prices this request at,
 * or undefined when the route has none (its reservation then prices the
 * identifier from model_pricing). Marked up ONCE, here, so the check, the
 * reservation and a quote all read the same final number.
 */
export async function routeCreditOverride(
  req: FastifyRequest,
  modelIdentifier: string,
  opts: CreditGuardOpts | undefined,
): Promise<number | undefined> {
  if (!opts?.computeCredits) return undefined
  const baseCredits = await opts.computeCredits(req.body, req)
  if (baseCredits === undefined) return undefined
  return applyServiceMarkup(baseCredits, await getAppSettings(), modelIdentifier)
}

/**
 * What a run of this request RESERVES when it starts — the number
 * `POST /v1/quote` answers. The same two sources the guard and
 * `CreditsService.reserveCredits` use: the route's computed override, else the
 * identifier's charged model_pricing row (`getModelCreditCostFromDB`, the lookup
 * `reserveCredits` falls back to). A batch is the sum of its jobs'.
 */
export async function reservedCreditsFor(
  req: FastifyRequest,
  modelIdentifier: string,
  opts: CreditGuardOpts | undefined,
): Promise<number> {
  const batchIds = opts?.batchIdentifiers?.(req)
  if (batchIds) return chargedBatchTotal(batchIds)
  return (await routeCreditOverride(req, modelIdentifier, opts))
    ?? (await getModelCreditCostFromDB(modelIdentifier)).creditCost
}

/** BASE credits marked up at `modelIdentifier`, the way a reservation is. */
export async function markedUpCredits(baseCredits: number, modelIdentifier: string): Promise<number> {
  return applyServiceMarkup(baseCredits, await getAppSettings(), modelIdentifier)
}

/** A refusal as the guard sends it: the status and the body, verbatim. */
export interface CreditRefusal {
  statusCode: number
  body: unknown
}

/**
 * What the guard answers when the payer's pools cannot cover a run — ONE
 * builder for the guard (Step 2) and `checkPayerCanAffordImpl`, so the two
 * can never answer the same shortfall in two dialects.
 *
 * - A payg account on a consumer surface (web-free mode): the subscription
 *   ask (403) — the topup pool is developer-surface money.
 * - A deployment payer: the wallet that came up short is the OPERATOR's, not
 *   this requester's. Echoing `balance` would hand every user the operator's
 *   pool size — the same figure the consumption-only /usage page exists to
 *   keep private, and this response reaches anyone who can press Generate.
 *   And the requester cannot resolve this at all: they hold no wallet, and a
 *   prepaid instance withholds self-serve purchase, so the stock
 *   "insufficient credits" copy sends them to a dead end. Name the real
 *   condition and the real fixer instead.
 * - Otherwise the plain 402 with what the run needs and what the payer has.
 */
export function insufficientCreditsRefusal(
  check: { error?: string; required?: number; balance?: number; subscriptionRequired?: boolean },
  deploymentPayer: boolean,
): CreditRefusal {
  if (check.subscriptionRequired) return { statusCode: 403, body: SUBSCRIPTION_REQUIRED_BODY }
  if (deploymentPayer) {
    return {
      statusCode: 402,
      body: {
        error: { code: "insufficient_credits", message: DEPLOYMENT_OUT_OF_CREDITS },
        required: check.required,
      },
    }
  }
  return {
    statusCode: 402,
    body: {
      error: { code: "insufficient_credits", message: check.error ?? "Insufficient credits" },
      required: check.required,
      balance: check.balance,
    },
  }
}

/**
 * Track A — the per-user allowance pre-flight under a deployment payer, or
 * null when the allowance covers `required` (or the user has none).
 *
 * NON-AUTHORITATIVE, on purpose (D8). This is a read-then-reserve: two
 * parallel Generates can both read "enough" and both reserve. The authority
 * is the block inside `reserve_credits`, holding `FOR UPDATE` on the
 * allowance row in the same transaction that debits the payer; the overshoot
 * a race here can produce is bounded by that, never by this. What this buys
 * is a truthful 402 for the ordinary case, before a job row is created and
 * refunded.
 *
 * The figures are RAW credits and are the requester's OWN (D10): the payer's
 * pool never appears here, in any key, for the same reason
 * `insufficientCreditsRefusal` withholds `balance` from a deployment payer.
 *
 * The D7 no-row rule (a user who has never generated has no row and must
 * answer the DEFAULT, never 0) lives in `allowanceFor`. Reading the table
 * here instead would put a second copy of that rule in the one place where
 * getting it wrong refuses every user's first ever Generate.
 */
async function allowanceRefusal(userId: string, required: number): Promise<CreditRefusal | null> {
  const allowance = await allowanceFor(userId)
  if (!allowance || required <= allowance.remaining) return null
  return {
    statusCode: 402,
    body: {
      error: {
        // Same code and same fixed message the reserve RPC's own refusal maps
        // to (reserve-errors.ts, USER_ALLOWANCE_EXCEEDED): one refusal seen
        // from two places must not read as two.
        code: "user_allowance_exceeded",
        message: "Your allowance cannot cover this run",
      },
      required,
      remaining: allowance.remaining,
    },
  }
}

export function creditGuardImpl(
  modelResolver: (req: FastifyRequest) => string,
  opts?: CreditGuardOpts,
) {
  return async function creditGuardHandler(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = req.userId
    if (!userId) return

    const modelIdentifier = modelResolver(req)

    // FFmpeg operations are free — skip all credit/storage checks
    if (modelIdentifier === "ffmpeg") return

    const routeName = req.url.split("?")[0] ?? "unknown"

    // Resolve the dynamic credit override, if any. Apply admin markup once
    // here so both checkCreditsWithProfile and reserveCredits receive a
    // final post-markup number.
    let computedCreditOverride: number | undefined
    // A batch (several jobs in one request): the check prices the WHOLE batch,
    // already marked up per job, so it is not marked up again here. It is a
    // pre-flight figure only — never left on the reservation (see below).
    // An EMPTY list is still a batch: one whose jobs all exist and are paid for
    // (a keyed repeat that only re-queues them) — checked at 0, never priced as
    // one image.
    const batchIds = opts?.batchIdentifiers?.(req)
    if (batchIds) {
      try {
        computedCreditOverride = await chargedBatchTotal(batchIds)
      } catch (err) {
        if (handlePriceNotConfigured(err, reply, routeName)) return
        throw err
      }
    } else if (opts?.computeCredits) {
      try {
        computedCreditOverride = await routeCreditOverride(req, modelIdentifier, opts)
      } catch (err) {
        // Hard-fail policy: a missing-price error during computeCredits must
        // reject the request, not silently proceed without a credit check.
        if (handlePriceNotConfigured(err, reply, routeName)) return
        throw err
      }
    }

    // Deployment payer (item 9): the account whose pools gate this
    // request is the PAYER's, so the profile below is fetched for it — the
    // requester's balance is a frozen signup grant nothing ever debits, and
    // evaluating it would 402 the whole instance the day those grants run
    // out. This applies on check-only routes too, deliberately: unlike the
    // workspace exclusion (whose budget a check-only route never debits — a
    // free proxy), the payer's pool IS what the reserving twin will debit,
    // so the wealth check against it is the honest answer.
    const dep = req.billingContext?.payer === "deployment" ? req.billingContext : undefined

    // Welcome offer: while it is on, the profile read also carries the
    // consent-pending mark (one column on the same query — the column exists
    // only from migration 426, so it is asked for only behind the flag).
    const welcomeOffer = dep ? { enabled: false } : await getWelcomeOfferConfig()

    // Fetch profile ONCE with all columns needed by both storage + credit checks
    const { data: profile, error: profileError } = (await supabase
      .from("profiles")
      .select(GUARD_PROFILE_COLUMNS + (welcomeOffer.enabled ? ", welcome_consent_pending" : ""))
      .eq("id", payerProfileId(userId, req.billingContext))
      .single()) as unknown as { data: GuardProfileRow | null; error: unknown }

    if (profileError || !profile) {
      reply.status(500).send({
        error: { code: "credit_check_failed", message: "User profile not found" },
      })
      return
    }

    // Step -1: the consent an extension-granted account still owes. The RULE
    // is in CreditsService.reserveCredits (every spend funnels there); this is
    // the same refusal answered early, as a 403 the browser turns into the
    // consent ask. The extension itself keeps working — its sub-requests
    // forward the browser-set extension Origin (welcome-consent-gate.ts);
    // every other surface, the orchestrator's internal hops included, is
    // blocked until the user says yes somewhere. Check-only routes (cost
    // estimates that fire on render) are let through: they reserve nothing,
    // and refusing them would pop the consent ask on every hover.
    if (welcomeOffer.enabled && !opts?.checkOnly && profile.welcome_consent_pending === true && !consentBlockExempt(req)) {
      sendConsentRequired(reply)
      return
    }

    // The role in hand is the PAYER's under a deployment payer — warming the
    // requester's admin cache with it would be a privilege confusion.
    if (!dep) warmAdminCache(userId, profile.role ?? undefined)

    // Step 0: spend-surface mode (D1 v2, pool-aware) — on a consumer surface
    // a payg account spends its FREE pool only, under free-tier semantics.
    // The flag is a surface predicate; payg-ness resolves inside the credit
    // check / reservation / RPC, so free users and subscribers see no change.
    // OR-preserve: internal orchestrator calls arrive with the flag already
    // stamped by auth (X-Web-Free-Mode) — the surface predicate must not
    // erase it (internal calls have no Origin and would derive false).
    req.webFreeMode = req.webFreeMode === true || isWebFreeModeCandidate(req)
    const communityInstance = req.appAuthorization?.appKind === "community_instance"

    // Step 0b: per-instance monthly spend cap (Phase 4a containment trio).
    // Rollup is read-then-check — a small overshoot race is acceptable for
    // MVP (documented in the PR); the cap is a soft budget, not a ledger.
    if (communityInstance && req.appAuthorization?.monthlySpendCapCredits != null) {
      const spent = await monthlyInstanceSpend(userId, req.appAuthorization.appId)
      if (spent >= req.appAuthorization.monthlySpendCapCredits) {
        reply.status(402).send({
          error: {
            code: "instance_cap_reached",
            message: `This instance reached its monthly spend cap (${req.appAuthorization.monthlySpendCapCredits} credits). Raise or remove the cap from Connected Instances.`,
          },
        })
        return
      }
    }

    // Step 1: storage limit — SKIPPED under a deployment payer: media lives
    // in the deployment's own bucket (their space, their business), and the
    // profile in hand carries the PAYER's storage columns, which would gate
    // every requester on one account's counter. Also skipped on a route that
    // stores no media (`skipStorageCheck`): text records are not media.
    if (dep || opts?.skipStorageCheck) {
      // fallthrough to the credit check with no storage snapshot
    } else try {
      const storageCheck = CreditsService.checkStorageLimitWithProfile(profile as StorageProfile)
      // Effective tier for the 413 payload + storage snapshot — payg users
      // must see their real entitlement tier in storage errors, not "free".
      const tier = resolveEffectiveTier({
        tier: (profile as CreditProfile).tier ?? null,
        subscription_tier: (profile as CreditProfile).subscription_tier ?? null,
        lifetime_topup_credits: (profile as CreditProfile).lifetime_topup_credits,
      })

      if (!storageCheck.allowed) {
        reply.status(413).send({
          error: {
            code: "storage_limit_exceeded",
            message: storageCheck.error ?? "Storage limit exceeded",
            usedBytes: storageCheck.usedBytes,
            quotaBytes: storageCheck.limitBytes,
            remainingBytes: Math.max(0, storageCheck.limitBytes - storageCheck.usedBytes),
            tier,
          },
        })
        return
      }

      const storageSnapshot: StorageSnapshot = {
        usedBytes: storageCheck.usedBytes,
        limitBytes: storageCheck.limitBytes,
        tier,
      }
      req.storageSnapshot = storageSnapshot
    } catch (err) {
      console.error(`[credit-guard] ${routeName} storage check failed:`, err)
      // Non-fatal: allow the request to proceed if storage check fails
    }

    // Step 2: credit check
    try {
      const checkModel = (identifier: string) => CreditsService.checkCreditsWithProfile(
        userId,
        profile as CreditProfile,
        identifier,
        req.isAppRun,
        computedCreditOverride,
        {
          webFreeMode: req.webFreeMode ?? false,
          communityInstance,
          // P14/W4c: the workspace entitlement override applies ONLY where a
          // reservation follows. A checkOnly route is a wealth check that
          // reserves nothing — a workspace context there would pass callers
          // out of a budget nothing ever debits (a free proxy, no payer).
          // A DEPLOYMENT context is exempt from the exclusion (see `dep`
          // above): the profile in hand is already the payer's, and checking
          // it under the requester's free-tier gates would be the lie.
          ...(opts?.checkOnly && !dep ? {} : { billingContext: req.billingContext }),
          // The free-credit video limits read the request's own video params
          // only where the route RESERVES a video model: a text route that
          // merely names a target video model (Prompt Helper) is not a run.
          video: req.freeVideoRequest ?? (readsVideoBody(identifier.split(":")[0] ?? "") ? freeVideoRequestOf(req.body as Record<string, unknown> | undefined) : undefined),
        },
      )
      // A batch asks once per DISTINCT model, each against the whole batch's
      // total: the balance answer is the same every time, and each model's
      // own switch and tier restriction is asked about. The first refusal is
      // the answer.
      const checkIds = batchIds ? [...new Set(batchIds)] : [modelIdentifier]
      let creditCheck = await checkModel(checkIds[0] ?? modelIdentifier)
      for (const identifier of checkIds.slice(1)) {
        if (!creditCheck.allowed) break
        creditCheck = await checkModel(identifier)
      }

      if (!creditCheck.allowed) {
        // Pool-aware web spending: the free pool can't cover this run — the
        // remaining (topup) credits are developer-surface money, so the
        // answer is the subscription modal, not a plain 402.
        // The free-credit video limits: a 402 like every "pay to unlock"
        // refusal (the SDK's InsufficientCreditsError, an upsell flow), with
        // its own code so every client and language names the limit rather
        // than a balance.
        if (creditCheck.code === "free_video_limit") {
          reply.status(402).send({ error: { code: "free_video_limit", message: creditCheck.error ?? "Not available on free credits" } })
          return
        }
        // The subscription ask, the deployment payer's private-pool refusal,
        // or the plain 402 — see insufficientCreditsRefusal.
        const refusal = insufficientCreditsRefusal(creditCheck, Boolean(dep))
        reply.status(refusal.statusCode).send(refusal.body)
        return
      }

      // Track A — the per-user allowance pre-flight (allowanceRefusal), AFTER
      // the payer wealth check has passed (the pool must be able to pay before
      // the quota is even a question) and BEFORE a job row exists.
      //
      // TWO gates, both load-bearing. `dep` keeps mainline out entirely.
      // `allowanceEnforcementActive()` keeps the whole rollout window before
      // the flip out: `billing.allowances` is "off" until rollout step 8, and
      // until then this guard must refuse NOTHING even though balances are
      // already on screen. `required` can be absent (credits disabled) — with
      // no cost to compare there is nothing to refuse.
      if (dep && allowanceEnforcementActive() && creditCheck.required != null) {
        const refusal = await allowanceRefusal(userId, creditCheck.required)
        if (refusal) {
          reply.status(refusal.statusCode).send(refusal.body)
          return
        }
      }

      const reservation: CreditReservation = {
        usageLogId: "",
        creditsReserved: 0,
        watermark: creditCheck.watermark ?? false,
        // A batch total is never an override: every job of the batch would
        // reserve the whole batch. Each prices its own identifier instead.
        creditOverride: batchIds ? undefined : computedCreditOverride,
      }
      req.creditReservation = reservation
    } catch (err) {
      // Hard-fail policy: missing-price misconfig → 503 (handled below)
      if (handlePriceNotConfigured(err, reply, routeName)) return
      console.error(`[credit-guard] ${routeName} credit check failed:`, err)
      reply.status(500).send({
        error: { code: "credit_check_failed", message: "Failed to check credits" },
      })
    }
  }
}

/**
 * Can the payer of this request afford `credits` (final, already marked-up
 * credits) right now? The toolkit's `http.checkPayerCanAfford` — for a route
 * that starts work whose jobs reserve their own credits later and must refuse
 * up front when the payer cannot cover the whole run.
 *
 * Balance only, on the payer the guard reads (`checkRunSetCredits`: the
 * payer's profile through `payerProfileId`, the reservation's `spendGates`).
 * Model availability, free-tier limits and daily caps stay with each job's
 * own guard. A refusal is exactly what the guard sends for the same shortfall
 * (`insufficientCreditsRefusal`, `allowanceRefusal`); a deployment payer's
 * pool is never echoed.
 *
 * A WORKSPACE payer is checked against the workspace's headroom for this
 * member (the org-billing service's ONE formula, the payer-aware estimate's
 * preview: the lower of the budget's and the member cap's headroom) and
 * refused in the reserve RPC's words (`budget_exceeded`). Stricter than the
 * guard, which leaves the budget to the reservation — this is asked for a
 * whole run before any of its jobs exist. Without a headroom answer (an older
 * plugin, a failed read) it passes: the reservation stays the authority.
 *
 * Holds nothing and writes nothing — no reservation, no `creditOverride`, and
 * `req.webFreeMode` is read, never stamped. Rejects on an internal failure
 * (an unreadable payer profile, a bad amount, no user).
 */
export async function checkPayerCanAffordImpl(
  req: FastifyRequest,
  credits: number,
): Promise<PayerAffordability> {
  if (typeof credits !== "number" || !Number.isFinite(credits) || credits < 0) {
    throw new Error("checkPayerCanAfford: credits must be a finite non-negative number")
  }
  const userId = req.userId
  if (!userId) throw new Error("checkPayerCanAfford: the request has no authenticated user")
  // A run that costs nothing is never refused for credits, whatever the
  // balance reads (an overdrawn pool, a deployment's empty one).
  if (credits === 0) return { ok: true }

  // The request's resolved payer — or, where the billing hook did not run
  // (GET / HEAD, a route it skips), the decision `requestBillingContext`
  // makes first: under a configured deployment payer EVERY request is the
  // payer's, so its pool is checked and never echoed (the payer's own app
  // token included — refusePayerBalanceToProgrammaticCaller's rule).
  const ctx = req.billingContext ?? (deploymentPayerActive() ? deploymentBillingContext(userId) : undefined)
  if (ctx?.payer === "workspace") return workspaceAffords(ctx, credits)

  const dep = ctx?.payer === "deployment"
  // The guard's own surface predicate (OR-preserving the flag auth stamped on
  // an internal hop) — computed here, never written back onto the request.
  const webFreeMode = req.webFreeMode === true || isWebFreeModeCandidate(req)
  const check = await checkRunSetCredits(userId, credits, { billingContext: ctx, webFreeMode })
  if (!check.sufficient) {
    return {
      ok: false,
      ...insufficientCreditsRefusal(
        {
          error: check.message,
          required: check.required,
          balance: check.available ?? undefined,
          subscriptionRequired: check.subscriptionRequired,
        },
        dep,
      ),
    }
  }
  if (dep && allowanceEnforcementActive()) {
    const refusal = await allowanceRefusal(userId, credits)
    if (refusal) return { ok: false, ...refusal }
  }
  return { ok: true }
}

async function workspaceAffords(
  ctx: Extract<BillingContext, { payer: "workspace" }>,
  credits: number,
): Promise<PayerAffordability> {
  const billing = billingService()
  const preview = billing?.headroom ? await billing.headroom(ctx.workspaceId, ctx.userId) : null
  if (!preview || credits <= preview.headroomCredits) return { ok: true }
  const refusal = reserveRefusalFor("BUDGET_EXCEEDED")
  if (!refusal) throw new Error("checkPayerCanAfford: the BUDGET_EXCEEDED refusal is not mapped")
  return { ok: false, statusCode: refusal.status, body: { error: { code: refusal.code, message: refusal.message } } }
}

export async function reserveCreditsForJobImpl(
  req: FastifyRequest,
  reply: FastifyReply,
  jobId: string,
  modelIdentifier: string,
  options?: { oncePerJob?: boolean; retainJobOnFailure?: boolean },
): Promise<ReserveResult | undefined> {
  const userId = req.userId
  if (!userId) return undefined

  const routeName = req.url.split("?")[0] ?? "unknown"

  try {
    const reservation = await CreditsService.reserveCredits(
      userId,
      jobId,
      modelIdentifier,
      0,
      0,
      {
        // P14/W4c: the request's resolved payer rides the reservation. The
        // preHandler stamped it once (resolve-once); this is a carry, never
        // a re-derivation.
        billingContext: req.billingContext,
        watermarkOverride: req.creditReservation?.watermark,
        isAppRun: req.isAppRun,
        // Third-party OAuth-app operations must never pump the owner's card
        // (design §5.2 step 1); Phase 4 instance credentials join this same
        // exclusion predicate. (A workspace payer is additionally excluded
        // INSIDE reserveCredits, as an invariant — not a flag here.)
        skipAutoRecharge: Boolean(req.appAuthorization),
        creditOverride: req.creditReservation?.creditOverride,
        ...(options?.oncePerJob ? { oncePerJob: true } : {}),
        webFreeMode: req.webFreeMode,
        communityInstance: req.appAuthorization?.appKind === "community_instance",
        // Welcome credits opt-in: the guard already refused every non-extension
        // request for a consent-owing account; the extension's own request is
        // the one reservation the funnel must let through. Sent ONLY when
        // true, so every other reservation's arguments are exactly what they
        // were before the offer existed.
        ...(consentBlockExempt(req) ? { consentPendingAllowed: true } : {}),
      },
    )

    if (!options?.oncePerJob) await supabase
      .from("jobs")
      .update({
        usage_log_id: reservation.usageLogId,
        credits: reservation.creditsReserved,
        should_watermark: reservation.watermark,
      })
      .eq("id", jobId)

    req.creditReservation = {
      usageLogId: reservation.usageLogId,
      creditsReserved: reservation.creditsReserved,
      watermark: reservation.watermark,
      creditOverride: req.creditReservation?.creditOverride,
    }

    return reservation
  } catch (err) {
    // The reserve RPC may have committed before its HTTP response was lost.
    // Reconcile by job id before deleting the orphan row so an ambiguous
    // transport failure cannot strand a reserved usage log (and its debit).
    // A caller that undoes its own jobs with a confirmed refund (the batch
    // lane) keeps the job and its holds: refund-then-delete here swallows a
    // failed refund and would strand the hold.
    if (!options?.oncePerJob && !options?.retainJobOnFailure) {
      await refundReservedCreditsForJob(jobId).catch((refundError) => {
        console.warn(
          `[credit-guard] ${routeName} ambiguous reservation refund failed job=${jobId}: ${(refundError as Error).message}`,
        )
      })
      // Legacy callers discard an unconfirmed job; resumable callers retain it.
      await supabase.from("jobs").delete().eq("id", jobId)
    }
    // Hard-fail policy: missing-price misconfig → 503 (handled below)
    if (handlePriceNotConfigured(err, reply, routeName)) return undefined
    const detail = err instanceof Error ? err.message : String(err)
    // TOCTOU backstop for pool-aware web mode: the RPC re-checks the free
    // pool atomically and raises with this marker when it can't cover.
    if (detail.includes("SUBSCRIPTION_REQUIRED:")) {
      sendSubscriptionRequired(reply)
      return undefined
    }
    // P14/W3: a workspace-payer refusal answers with its stable code and a
    // FIXED message — the raw RPC text (ids, amounts) stays in the log line.
    const mapped = mapReserveError(err)
    if (mapped) {
      console.warn(
        `[credit-guard] ${routeName} reserve refused job=${jobId} code=${mapped.code}: ${err instanceof ReserveRpcError ? err.raw : detail}`,
      )
      reply.status(mapped.status).send({ error: { code: mapped.code, message: mapped.message } })
      return undefined
    }
    console.error(`[credit-guard] ${routeName} credit reservation failed:`, detail)
    // Generic on the wire — the raw detail leaked schema/param text here for
    // years and the audit called it (W3): logs keep it, callers do not.
    reply.status(500).send({
      error: { code: "credit_reservation_failed", message: "Failed to reserve credits" },
    })
    return undefined
  }
}
