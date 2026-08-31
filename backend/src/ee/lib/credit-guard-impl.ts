// Heavy implementation of creditGuard + reserveCreditsForJob.
// Loaded dynamically by ../../middleware/credit-guard.ts only when hasCredits()
// is true. This keeps community/business builds free of any credit-system code
// at runtime.

import type { FastifyRequest, FastifyReply } from "fastify"
import { CreditsService, PriceNotConfiguredError, type ReserveResult, type CreditProfile, type StorageProfile } from "../billing/credits.js"
import { supabase } from "../../lib/supabase.js"
import { warmAdminCache } from "../../lib/admin-check.js"
import { getAppSettings } from "../../lib/app-settings.js"
import type { CreditReservation, StorageSnapshot, CreditGuardOpts } from "../../middleware/credit-guard.js"
import { resolveEffectiveTier } from "@nodaro/shared"
import { isWebFreeModeCandidate, sendSubscriptionRequired } from "./payg-surface-guard.js"
import { effectiveMarkupPercent } from "../billing/service-margin.js"
import { refundReservedCreditsForJob } from "../../lib/credits-job-lifecycle.js"
import { ReserveRpcError, mapReserveError } from "../../lib/reserve-errors.js"

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
    if (opts?.computeCredits) {
      try {
        const baseCredits = await opts.computeCredits(req.body, req)
        const settings = await getAppSettings()
        const markupPercent = effectiveMarkupPercent(settings, modelIdentifier)
        computedCreditOverride =
          markupPercent > 0 && baseCredits > 0
            ? Math.ceil(baseCredits * (1 + markupPercent / 100))
            : baseCredits
      } catch (err) {
        // Hard-fail policy: a missing-price error during computeCredits must
        // reject the request, not silently proceed without a credit check.
        if (handlePriceNotConfigured(err, reply, routeName)) return
        throw err
      }
    }

    // Deployment payer (SAI item 9): the account whose pools gate this
    // request is the PAYER's, so the profile below is fetched for it — the
    // requester's balance is a frozen signup grant nothing ever debits, and
    // evaluating it would 402 the whole instance the day those grants run
    // out. This applies on check-only routes too, deliberately: unlike the
    // workspace exclusion (whose budget a check-only route never debits — a
    // free proxy), the payer's pool IS what the reserving twin will debit,
    // so the wealth check against it is the honest answer.
    const dep = req.billingContext?.payer === "deployment" ? req.billingContext : undefined

    // Fetch profile ONCE with all columns needed by both storage + credit checks
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, tier, subscription_tier, lifetime_topup_credits, subscription_credits, topup_credits, daily_spent_credits, last_daily_reset, storage_used_bytes, storage_limit_bytes")
      .eq("id", dep ? dep.payerId : userId)
      .single()

    if (profileError || !profile) {
      reply.status(500).send({
        error: { code: "credit_check_failed", message: "User profile not found" },
      })
      return
    }

    // The role in hand is the PAYER's under a deployment payer — warming the
    // requester's admin cache with it would be a privilege confusion.
    if (!dep) warmAdminCache(userId, (profile as Record<string, unknown>).role as string | undefined)

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
    // every requester on one account's counter.
    if (dep) {
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
      const creditCheck = await CreditsService.checkCreditsWithProfile(
        userId,
        profile as CreditProfile,
        modelIdentifier,
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
        },
      )

      if (!creditCheck.allowed) {
        // Pool-aware web spending: the free pool can't cover this run — the
        // remaining (topup) credits are developer-surface money, so the
        // answer is the subscription modal, not a plain 402.
        if (creditCheck.subscriptionRequired) {
          sendSubscriptionRequired(reply)
          return
        }
        reply.status(402).send({
          error: {
            code: "insufficient_credits",
            message: creditCheck.error ?? "Insufficient credits",
          },
          required: creditCheck.required,
          balance: creditCheck.balance,
        })
        return
      }

      const reservation: CreditReservation = {
        usageLogId: "",
        creditsReserved: 0,
        watermark: creditCheck.watermark ?? false,
        creditOverride: computedCreditOverride,
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

export async function reserveCreditsForJobImpl(
  req: FastifyRequest,
  reply: FastifyReply,
  jobId: string,
  modelIdentifier: string,
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
        webFreeMode: req.webFreeMode,
        communityInstance: req.appAuthorization?.appKind === "community_instance",
      },
    )

    await supabase
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
    await refundReservedCreditsForJob(jobId).catch((refundError) => {
      console.warn(
        `[credit-guard] ${routeName} ambiguous reservation refund failed job=${jobId}: ${(refundError as Error).message}`,
      )
    })
    // Clean up the stale job row before responding (same as the legacy 500 path).
    await supabase.from("jobs").delete().eq("id", jobId)
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
