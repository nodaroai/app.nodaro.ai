import type { FastifyRequest, FastifyReply } from "fastify"
import { hasCredits } from "../lib/config.js"
import { CreditsService, type ReserveResult, type CreditProfile, type StorageProfile } from "../billing/credits.js"
import { supabase } from "../lib/supabase.js"
import { warmAdminCache } from "../lib/admin-check.js"
import { getAppSettings } from "../lib/app-settings.js"

/**
 * Credit reservation attached to the request by creditGuard middleware.
 * Routes read this to pass usageLogId to queue jobs.
 */
export interface CreditReservation {
  usageLogId: string
  creditsReserved: number
  watermark: boolean
  /** Set by creditGuard when a route uses computeCredits. Passed through
   *  to reserveCredits so the same number is debited as was checked. */
  creditOverride?: number
}

/**
 * Storage usage snapshot attached to the request by creditGuard.
 * Routes that stream remote content into R2 use this to cap the upload
 * against the user's remaining quota without re-querying profiles.
 */
export interface StorageSnapshot {
  usedBytes: number
  limitBytes: number
  tier: string
}

// Note: FastifyRequest augmentation (userId, userRole, creditReservation)
// is in ./auth.ts which is the canonical source for the declare module block.

/**
 * Creates a Fastify preHandler that checks and reserves credits.
 *
 * @param modelResolver - Function that extracts the model identifier from the request body.
 *   For AI routes this is typically `(req) => req.body.provider ?? "default-provider"`.
 *   For FFmpeg processing routes use `() => "ffmpeg"`.
 *
 * @returns Fastify preHandler function
 *
 * Behavior by edition:
 * - community: skips entirely (no credit system)
 * - business: skips entirely (users pay providers directly)
 * - cloud: checks credits, reserves them, attaches reservation to request
 *
 * On success: request.creditReservation is set with { usageLogId, creditsReserved, watermark }
 * On failure: returns 402 (insufficient credits), 413 (storage limit), or 500 (system error)
 */
export interface CreditGuardOpts {
  /** Returns BASE credits (pre-markup) from the parsed body. When supplied,
   *  bypasses the model_pricing lookup for cost only — isEnabled and
   *  tierRestriction still come from the DB row. */
  computeCredits?: (parsedBody: unknown) => number
}

export function creditGuard(
  modelResolver: (req: FastifyRequest) => string,
  opts?: CreditGuardOpts,
) {
  return async function creditGuardHandler(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    // Only cloud edition uses credits
    if (!hasCredits()) return

    const userId = req.userId

    // No userId means anonymous request - skip credit check
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

    // Pre-warm admin cache so subsequent checkIsAdmin() calls skip the DB
    warmAdminCache(userId, (profile as Record<string, unknown>).role as string | undefined)

    // Step 1: Check storage limit BEFORE credit check (for routes that produce output files)
    try {
      const storageCheck = CreditsService.checkStorageLimitWithProfile(profile as StorageProfile)
      const tier = (profile as CreditProfile).tier ?? "free"

      if (!storageCheck.allowed) {
        const quotaBytes = storageCheck.limitBytes
        const usedBytes = storageCheck.usedBytes

        reply.status(413).send({
          error: {
            code: "storage_limit_exceeded",
            message: storageCheck.error ?? "Storage limit exceeded",
            usedBytes,
            quotaBytes,
            remainingBytes: Math.max(0, quotaBytes - usedBytes),
            tier,
          },
        })
        return
      }

      req.storageSnapshot = {
        usedBytes: storageCheck.usedBytes,
        limitBytes: storageCheck.limitBytes,
        tier,
      }
    } catch (err) {
      console.error(`[credit-guard] ${routeName} storage check failed:`, err)
      // Non-fatal: allow the request to proceed if storage check fails
    }

    // Step 2: Check if user has enough credits (using pre-fetched profile)
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

      // Step 3: Store pending reservation with watermark from checkCredits
      // (avoids duplicate profiles query in reserveCredits)
      req.creditReservation = {
        usageLogId: "",
        creditsReserved: 0,
        watermark: creditCheck.watermark ?? false,
        creditOverride: computedCreditOverride,
      }
    } catch (err) {
      console.error(`[credit-guard] ${routeName} credit check failed:`, err)
      reply.status(500).send({
        error: { code: "credit_check_failed", message: "Failed to check credits" },
      })
      return
    }
  }
}

/**
 * Reserve credits after job creation. Call this from the route handler
 * after inserting the job into the database.
 *
 * @returns The reservation result, or undefined if credits are not active
 */
export async function reserveCreditsForJob(
  req: FastifyRequest,
  reply: FastifyReply,
  jobId: string,
  modelIdentifier: string
): Promise<ReserveResult | undefined> {
  if (!hasCredits()) return undefined

  const userId = req.userId
  if (!userId) return undefined

  const routeName = req.url.split("?")[0] ?? "unknown"

  try {
    const reservation = await CreditsService.reserveCredits(
      userId,
      jobId,
      modelIdentifier,
      0, // provider cost calculated in worker
      0, // display cost calculated in worker
      {
        watermarkOverride: req.creditReservation?.watermark,
        isAppRun: req.isAppRun,
        creditOverride: req.creditReservation?.creditOverride,
      },
    )

    // Store usageLogId, estimated credits, and watermark decision on the job
    await supabase
      .from("jobs")
      .update({
        usage_log_id: reservation.usageLogId,
        credits: reservation.creditsReserved,
        should_watermark: reservation.watermark,
      })
      .eq("id", jobId)

    // Update request with actual reservation (including watermark flag)
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
    // Delete the job if reservation fails
    await supabase.from("jobs").delete().eq("id", jobId)
    reply.status(500).send({
      error: { code: "credit_reservation_failed", message: `Failed to reserve credits: ${detail}` },
    })
    return undefined
  }
}
