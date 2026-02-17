import type { FastifyRequest, FastifyReply } from "fastify"
import { hasCredits } from "../lib/config.js"
import { CreditsService, type ReserveResult, type CreditProfile, type StorageProfile } from "../billing/credits.js"
import { supabase } from "../lib/supabase.js"
import { warmAdminCache } from "../lib/admin-check.js"

/**
 * Credit reservation attached to the request by creditGuard middleware.
 * Routes read this to pass usageLogId to queue jobs.
 */
export interface CreditReservation {
  usageLogId: string
  creditsReserved: number
  watermark: boolean
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
export function creditGuard(
  modelResolver: (req: FastifyRequest) => string
) {
  return async function creditGuardHandler(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    // Only cloud edition uses credits
    if (!hasCredits()) return

    // Prefer auth middleware userId, fall back to body for migration period
    const body = req.body as Record<string, unknown> | undefined
    const userId = req.userId ?? (body?.userId as string) ?? undefined

    // Store on request so route handlers can access it
    if (userId) req.userId = userId

    // No userId means anonymous request - skip credit check
    if (!userId) return

    const modelIdentifier = modelResolver(req)

    // FFmpeg operations are free — skip all credit/storage checks
    if (modelIdentifier === "ffmpeg") return

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

      if (!storageCheck.allowed) {
        const tier = (profile as CreditProfile).tier ?? "free"
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
    } catch (err) {
      console.error(`[credit-guard] ${routeName} storage check failed:`, err)
      // Non-fatal: allow the request to proceed if storage check fails
    }

    // Step 2: Check if user has enough credits (using pre-fetched profile)
    try {
      const creditCheck = await CreditsService.checkCreditsWithProfile(userId, profile as CreditProfile, modelIdentifier)

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
      req.creditReservation = { usageLogId: "", creditsReserved: 0, watermark: creditCheck.watermark ?? false }
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

  // FFmpeg operations are free — skip reservation
  if (modelIdentifier === "ffmpeg") return undefined

  // Prefer auth middleware userId, fall back to body for migration period
  const body = req.body as Record<string, unknown> | undefined
  const userId = req.userId ?? (body?.userId as string) ?? undefined
  if (!userId) return undefined

  const routeName = req.url.split("?")[0] ?? "unknown"

  try {
    const reservation = await CreditsService.reserveCredits(
      userId,
      jobId,
      modelIdentifier,
      0, // provider cost calculated in worker
      0, // display cost calculated in worker
      req.creditReservation?.watermark, // pass watermark from checkCredits
    )

    // Store usageLogId and estimated credits on the job
    await supabase
      .from("jobs")
      .update({
        usage_log_id: reservation.usageLogId,
        credits_estimated: reservation.creditsReserved,
      })
      .eq("id", jobId)

    // Update request with actual reservation (including watermark flag)
    req.creditReservation = {
      usageLogId: reservation.usageLogId,
      creditsReserved: reservation.creditsReserved,
      watermark: reservation.watermark,
    }

    return reservation
  } catch (err) {
    console.error(`[credit-guard] ${routeName} credit reservation failed:`, err)
    // Delete the job if reservation fails
    await supabase.from("jobs").delete().eq("id", jobId)
    reply.status(500).send({
      error: { code: "credit_reservation_failed", message: "Failed to reserve credits" },
    })
    return undefined
  }
}
