import type { FastifyRequest, FastifyReply } from "fastify"
import { hasCredits } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { computeFingerprint, findRecentMatchingJob } from "../lib/dedup-fingerprint.js"

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
   *  tierRestriction still come from the DB row. May be sync or async.
   *  Markup is applied inside creditGuard so checkCredits and reserveCredits
   *  receive the same final number. */
  computeCredits?: (parsedBody: unknown) => number | Promise<number>
  /** Anti-double-click dedup. Default: true. Set to false on routes whose
   *  response body shape is incompatible with `{ jobId, deduped: true }` —
   *  e.g., voice-clone returns `{ id, name, elevenlabsVoiceId, ... }` and
   *  the frontend would break on the simplified dedup response. */
  dedup?: boolean
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
 *   (loop-video, trim-video, combine-videos, image-to-video loopTrim, etc.).
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
  // Kick off the cloud impl import eagerly at route-registration time so
  // per-request await is just promise-resolution after the first call.
  const implPromise = hasCredits() ? import("../ee/lib/credit-guard-impl.js") : null
  const dedupEnabled = opts?.dedup !== false

  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Anti-double-click dedup (all editions). Runs BEFORE credit reservation
    // so duplicates never reserve. Skipped for unauthed requests (no userId)
    // or non-body requests (GET).
    if (dedupEnabled && req.userId && req.body) {
      const fp = computeFingerprint(req.url, req.body)
      const existing = await findRecentMatchingJob(req.userId, fp)
      if (existing) {
        reply.header("X-Dedup-Hit", "1")
        return reply.code(200).send({ jobId: existing.id, deduped: true })
      }
      req.inputFingerprint = fp
    }

    if (!implPromise) return
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
  // Backfill input_fingerprint for anti-double-click dedup (all editions).
  // creditGuard wrote `req.inputFingerprint` at preHandler time. Done here
  // (after the route's INSERT) so we don't need to touch every job-creating
  // route's INSERT statement — every job-creating route already calls
  // reserveCreditsForJob right after inserting the jobs row.
  if (req.inputFingerprint) {
    await supabase
      .from("jobs")
      .update({ input_fingerprint: req.inputFingerprint })
      .eq("id", jobId)
      .then(() => {}, (err) => {
        // Non-critical — dedup is best-effort. Failing to backfill just means
        // the next identical POST in the next 10s won't be deduped.
        console.warn(`[credit-guard] dedup backfill failed for job ${jobId}:`, err.message)
      })
  }
  if (!hasCredits()) return undefined
  const impl = await import("../ee/lib/credit-guard-impl.js")
  return impl.reserveCreditsForJobImpl(req, reply, jobId, modelIdentifier)
}
