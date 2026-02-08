import type { FastifyRequest, FastifyReply } from "fastify"
import { hasCredits } from "../lib/config.js"
import { CreditsService, type ReserveResult } from "../billing/credits.js"
import { supabase } from "../lib/supabase.js"

/**
 * Credit reservation attached to the request by creditGuard middleware.
 * Routes read this to pass usageLogId to queue jobs.
 */
export interface CreditReservation {
  usageLogId: string
  creditsReserved: number
}

/**
 * Extend Fastify request with credit reservation data and userId.
 * After creditGuard runs, request.creditReservation and request.userId are available.
 */
declare module "fastify" {
  interface FastifyRequest {
    creditReservation?: CreditReservation
    userId?: string
  }
}

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
 * On success: request.creditReservation is set with { usageLogId, creditsReserved }
 * On failure: returns 402 (insufficient credits) or 500 (system error)
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

    const body = req.body as Record<string, unknown> | undefined
    const userId = (body?.userId as string) ?? undefined

    // Always store userId on request so route handlers can access it
    req.userId = userId

    // No userId means anonymous request - skip credit check
    if (!userId) return

    const modelIdentifier = modelResolver(req)
    const routeName = req.url.split("?")[0] ?? "unknown"

    // Step 1: Check if user has enough credits
    try {
      const creditCheck = await CreditsService.checkCredits(userId, modelIdentifier)

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
    } catch (err) {
      console.error(`[credit-guard] ${routeName} credit check failed:`, err)
      reply.status(500).send({
        error: { code: "credit_check_failed", message: "Failed to check credits" },
      })
      return
    }

    // Step 2: Reserve credits (actual reservation happens after job creation in the route)
    // We store a "pending" reservation marker so the route knows to reserve after job insert
    req.creditReservation = { usageLogId: "", creditsReserved: 0 }
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

  const body = req.body as Record<string, unknown> | undefined
  const userId = (body?.userId as string) ?? undefined
  if (!userId) return undefined

  const routeName = req.url.split("?")[0] ?? "unknown"

  try {
    const reservation = await CreditsService.reserveCredits(
      userId,
      jobId,
      modelIdentifier,
      0, // provider cost calculated in worker
      0  // display cost calculated in worker
    )

    // Store usageLogId and estimated credits on the job
    await supabase
      .from("jobs")
      .update({
        usage_log_id: reservation.usageLogId,
        credits_estimated: reservation.creditsReserved,
      })
      .eq("id", jobId)

    // Update request with actual reservation
    req.creditReservation = {
      usageLogId: reservation.usageLogId,
      creditsReserved: reservation.creditsReserved,
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
