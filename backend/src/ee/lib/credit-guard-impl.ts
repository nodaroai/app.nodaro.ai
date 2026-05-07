// Heavy implementation of creditGuard + reserveCreditsForJob.
// Loaded dynamically by ../../middleware/credit-guard.ts only when hasCredits()
// is true. This keeps community/business builds free of any credit-system code
// at runtime.

import type { FastifyRequest, FastifyReply } from "fastify"
import { CreditsService, type ReserveResult, type CreditProfile, type StorageProfile } from "../billing/credits.js"
import { supabase } from "../../lib/supabase.js"
import { warmAdminCache } from "../../lib/admin-check.js"
import { getAppSettings } from "../../lib/app-settings.js"
import type { CreditReservation, StorageSnapshot, CreditGuardOpts } from "../../middleware/credit-guard.js"

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

    // Resolve the dynamic credit override, if any. Apply admin markup once
    // here so both checkCreditsWithProfile and reserveCredits receive a
    // final post-markup number.
    let computedCreditOverride: number | undefined
    if (opts?.computeCredits) {
      const baseCredits = opts.computeCredits(req.body)
      const settings = await getAppSettings()
      computedCreditOverride =
        settings.cost_markup_percent > 0 && baseCredits > 0
          ? Math.ceil(baseCredits * (1 + settings.cost_markup_percent / 100))
          : baseCredits
    }

    const routeName = req.url.split("?")[0] ?? "unknown"

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
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[credit-guard] ${routeName} credit reservation failed:`, detail)
    await supabase.from("jobs").delete().eq("id", jobId)
    reply.status(500).send({
      error: { code: "credit_reservation_failed", message: `Failed to reserve credits: ${detail}` },
    })
    return undefined
  }
}
