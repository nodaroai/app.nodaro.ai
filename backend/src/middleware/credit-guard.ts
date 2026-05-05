import type { FastifyRequest, FastifyReply } from "fastify"
import { hasCredits } from "../lib/config.js"

// Credit-guard shim. The 62 routes that import { creditGuard, reserveCreditsForJob }
// from this file see no behavioral change. In community/business editions, both
// functions short-circuit immediately. In cloud edition, they delegate to
// backend/src/ee/lib/credit-guard-impl.ts via dynamic import(). The dynamic
// import works under both Vitest (TS source) and production (compiled ESM).
// Node caches the module after first import, so per-request overhead is a
// trivial promise await.

export interface CreditReservation {
  usageLogId: string
  creditsReserved: number
  watermark: boolean
  /** Set by creditGuard when a route uses computeCredits. Passed through
   *  to reserveCredits so the same number is debited as was checked. */
  creditOverride?: number
}

export interface StorageSnapshot {
  usedBytes: number
  limitBytes: number
  tier: string
}

export interface CreditGuardOpts {
  /** Returns BASE credits (pre-markup) from the parsed body. When supplied,
   *  bypasses the model_pricing lookup for cost only — isEnabled and
   *  tierRestriction still come from the DB row. Markup is applied inside
   *  creditGuard so checkCredits and reserveCredits receive the same final
   *  number. */
  computeCredits?: (parsedBody: unknown) => number
}

// FastifyRequest augmentation (userId, userRole, creditReservation, storageSnapshot)
// is in ./auth.ts which is the canonical source for the declare module block.

/**
 * Creates a Fastify preHandler that checks and reserves credits.
 *
 * @param modelResolver - Function that extracts the model identifier from the request body.
 *   For AI routes this is typically `(req) => req.body.provider ?? "default-provider"`.
 *   For FFmpeg processing routes use `() => "ffmpeg"`.
 * @param opts - Optional hooks. `computeCredits(body)` returns BASE credits to
 *   override the model_pricing lookup for routes with dynamic pricing
 *   (loop-video, trim-video, combine-videos, etc.).
 *
 * Behavior by edition:
 * - community: returns a no-op preHandler
 * - business: returns a no-op preHandler (users pay providers directly)
 * - cloud: delegates to ee/lib/credit-guard-impl.ts (storage check + credit check)
 *
 * On success: request.creditReservation is set with { usageLogId, creditsReserved, watermark }
 * On failure: returns 402 (insufficient credits), 413 (storage limit), or 500 (system error)
 */
export function creditGuard(
  modelResolver: (req: FastifyRequest) => string,
  opts?: CreditGuardOpts,
) {
  if (!hasCredits()) {
    return async (_req: FastifyRequest, _reply: FastifyReply): Promise<void> => {}
  }
  // Kick off the import eagerly at route-registration time so per-request
  // await is just promise-resolution after the first call.
  const implPromise = import("../ee/lib/credit-guard-impl.js")
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const impl = await implPromise
    return impl.creditGuardImpl(modelResolver, opts)(req, reply)
  }
}

/**
 * Reserve credits after job creation. Call this from the route handler
 * after inserting the job into the database.
 *
 * In community/business: returns undefined (no-op).
 * In cloud: delegates to ee/lib/credit-guard-impl.ts.
 */
export async function reserveCreditsForJob(
  req: FastifyRequest,
  reply: FastifyReply,
  jobId: string,
  modelIdentifier: string,
): Promise<CreditReservation | undefined> {
  if (!hasCredits()) return undefined
  const impl = await import("../ee/lib/credit-guard-impl.js")
  return impl.reserveCreditsForJobImpl(req, reply, jobId, modelIdentifier)
}
