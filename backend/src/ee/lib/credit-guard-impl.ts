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
        const baseCredits = await opts.computeCredits(req.body)
        const settings = await getAppSettings()
        computedCreditOverride =
          settings.cost_markup_percent > 0 && baseCredits > 0
            ? Math.ceil(baseCredits * (1 + settings.cost_markup_percent / 100))
            : baseCredits
      } catch (err) {
        // Hard-fail policy: a missing-price error during computeCredits must
        // reject the request, not silently proceed without a credit check.
        if (handlePriceNotConfigured(err, reply, routeName)) return
        throw err
      }
    }

    // Fetch profile ONCE with all columns needed by both storage + credit checks
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, tier, subscription_tier, subscription_credits, topup_credits, daily_spent_credits, last_daily_reset, storage_used_bytes, storage_limit_bytes")
      .eq("id", userId)
      .single()

    if (profileError || !profile) {
      reply.status(500).send({
        error: { code: "credit_check_failed", message: "User profile not found" },
      })
      return
    }

    warmAdminCache(userId, (profile as Record<string, unknown>).role as string | undefined)

    // Step 1: storage limit
    try {
      const storageCheck = CreditsService.checkStorageLimitWithProfile(profile as StorageProfile)
      const tier = (profile as CreditProfile).tier ?? "free"

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
      )

      if (!creditCheck.allowed) {
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
        watermarkOverride: req.creditReservation?.watermark,
        isAppRun: req.isAppRun,
        creditOverride: req.creditReservation?.creditOverride,
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
    // Clean up the stale job row before responding (same as the legacy 500 path).
    await supabase.from("jobs").delete().eq("id", jobId)
    // Hard-fail policy: missing-price misconfig → 503 (handled below)
    if (handlePriceNotConfigured(err, reply, routeName)) return undefined
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[credit-guard] ${routeName} credit reservation failed:`, detail)
    reply.status(500).send({
      error: { code: "credit_reservation_failed", message: `Failed to reserve credits: ${detail}` },
    })
    return undefined
  }
}
