import type { FastifyRequest, FastifyReply } from "fastify"
import { hasCredits } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import {
  computeFingerprint,
  findRecentMatchingJob,
  MIN_IDEMPOTENCY_KEY_LENGTH,
} from "../lib/dedup-fingerprint.js"

/** Re-exported for any existing consumers that imported it from here.
 *  Authoritative declaration lives in `lib/dedup-fingerprint.ts`. */
export { MIN_IDEMPOTENCY_KEY_LENGTH } from "../lib/dedup-fingerprint.js"

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
    // OAuth app-token scope gate (cloud only). An app token authenticates AS the
    // resource owner and spends THEIR credits. Per-route requireScope() is opt-in
    // and only a handful of routes use it, so every credit-spending generation
    // route was reachable by an app granted ONLY read scopes (e.g. jobs:read) on
    // the consent screen — draining the owner's balance against the contract the
    // user approved. Require at least one :write/:execute scope to spend credits.
    // (User JWTs / API tokens have no appAuthorization → unaffected; self-hosted
    // editions return a no-op preHandler before this via hasCredits().)
    if (hasCredits() && req.appAuthorization) {
      const canSpend = req.appAuthorization.scopes.some(
        (s) => s.endsWith(":execute") || s.endsWith(":write"),
      )
      if (!canSpend) {
        return reply.code(403).send({
          error: {
            code: "insufficient_scope",
            message:
              "This app's granted scopes do not permit credit-spending generation; a :write or :execute scope is required.",
          },
        })
      }
    }

    // Dedup is INTENT-DRIVEN, not body-driven. AI generation legitimately
    // produces different outputs from the same body (seeds, stochastic
    // sampling), so two clicks on Generate with identical params should
    // create two jobs — not collapse. The ONLY way to distinguish
    // "accidental duplicate" (React StrictMode double-render, network
    // retry, double-click before button disable) from "intentional re-run"
    // is for the client to supply a stable per-click idempotency key.
    //
    // Policy:
    //   - Header present (≥ MIN length) → use as dedup key.
    //   - Header absent → NO dedup. Every request creates a fresh row.
    //     The DB UNIQUE constraint excludes NULL keys (partial index from
    //     migration 163), so unkeyed INSERTs never collide.
    //
    // We still compute the body fingerprint and stash it on req as
    // `inputFingerprint` — it's now diagnostic-only (admin observability,
    // anomaly detection), not a dedup key.
    if (dedupEnabled && req.userId && req.body) {
      req.inputFingerprint = computeFingerprint(req.url, req.body)

      const headerRaw = req.headers["idempotency-key"]
      const headerKey = typeof headerRaw === "string" ? headerRaw.trim() : ""
      if (headerKey.length >= MIN_IDEMPOTENCY_KEY_LENGTH) {
        // Best-effort fast path: SELECT for a recent match with this key.
        // Short-circuit before any credit check on hit. The race that two
        // concurrent callers both pass this SELECT is closed at the INSERT
        // layer — routes use `insertWithIdempotencyKey` which relies on
        // the DB UNIQUE constraint on (user_id, idempotency_key).
        const existing = await findRecentMatchingJob(req.userId, headerKey)
        if (existing) {
          reply.header("X-Dedup-Hit", "1")
          return reply.code(200).send({ jobId: existing.id, deduped: true })
        }
        req.idempotencyKey = headerKey
      }
      // else: no idempotency key at all. Route's insertWithIdempotencyKey
      // sees `undefined` and does a plain INSERT — no dedup whatsoever.
    }

    if (!implPromise) return
    const impl = await implPromise
    return impl.creditGuardImpl(modelResolver, opts)(req, reply)
  }
}

/** Postgres SQLSTATE for unique-constraint violations. PostgREST surfaces
 *  this verbatim on `error.code`. We treat it as the authoritative signal
 *  that we are the racing loser in an idempotency-key collision. */
const PG_UNIQUE_VIOLATION = "23505"

/**
 * Reserve credits after job creation. Call this from the route handler
 * after inserting the job into the database.
 *
 * Also closes the dedup race for routes that still do a plain INSERT (every
 * route except generate-image/video, text-to-video, workflow-execution).
 * The route's INSERT writes the row with `idempotency_key = NULL` — the
 * partial UNIQUE index `(user_id, idempotency_key) WHERE idempotency_key
 * IS NOT NULL` excludes NULL keys, so two concurrent INSERTs both succeed.
 * This function then tries to UPDATE the row to set `idempotency_key`:
 *
 *   - First caller's UPDATE wins.
 *   - Second caller's UPDATE hits the UNIQUE constraint (23505). We
 *     interpret that as "we are the loser of a dedup race": delete our
 *     just-inserted duplicate, SELECT the winner's job_id, send the
 *     standard `{ jobId, deduped: true }` dedup-hit response with the
 *     X-Dedup-Hit header, and return undefined. The caller's
 *     `if (reply.sent) return` guard (which all job-creating routes
 *     already have) keeps it from enqueueing duplicate work or
 *     reserving credits.
 *
 * Because the backfill runs BEFORE the credit reservation, the loser
 * never hits the credit-deduction path — nothing to refund.
 *
 * In community/business: skips the cloud credit reservation but still
 * runs the dedup-race detection.
 */
export async function reserveCreditsForJob(
  req: FastifyRequest,
  reply: FastifyReply,
  jobId: string,
  modelIdentifier: string,
): Promise<CreditReservation | undefined> {
  if (req.inputFingerprint || req.idempotencyKey) {
    const update: Record<string, unknown> = {}
    if (req.inputFingerprint) update.input_fingerprint = req.inputFingerprint
    if (req.idempotencyKey) update.idempotency_key = req.idempotencyKey

    const { error } = await supabase
      .from("jobs")
      .update(update)
      .eq("id", jobId)

    if (error) {
      // Unique-violation = idempotency-key race lost. The "winner" exists.
      // Clean up the loser row + redirect to the winner via dedup-hit.
      if (error.code === PG_UNIQUE_VIOLATION && req.idempotencyKey && req.userId) {
        const winnerId = await resolveDedupWinnerAndCleanup(
          req.userId,
          req.idempotencyKey,
          jobId,
        )
        if (winnerId) {
          reply.header("X-Dedup-Hit", "1")
          reply.code(200).send({ jobId: winnerId, deduped: true })
          return undefined
        }
        // Winner unresolvable: SELECT either returned no row (winner row
        // was hard-deleted in the brief window between the UNIQUE violation
        // firing and our lookup) or errored (transient DB blip). VERY rare
        // in practice.
        //
        // Correct recovery: best-effort delete the orphan loser row + send
        // 503 with a structured `dedup_race_winner_unresolvable` code +
        // Retry-After. This preserves the `if (reply.sent) return`
        // contract every route relies on — including batch routes like
        // video-sfx whose rollback logic lives behind that guard. Throwing
        // would bypass `reply.sent` entirely, orphan the route's already-
        // INSERTed jobs, and leak the raw error message to clients.
        //
        // DELETE is fire-and-forget (`void`) like the dedup-hit path: we
        // already know the orphan row is functionally inert (no
        // idempotency_key set, no usage_log_id, no worker enqueued), and
        // awaiting under a degraded DB could hang the 503 response for
        // the full supabase-js timeout. The cleanup cron is the same
        // backstop both paths rely on for true orphan cleanup.
        //
        // Retry-After: 2 seconds with a comment about jitter — the rare
        // 503 cluster (concurrent clients hitting the same race during
        // a DB blip) should not all retry on the same tick. Clients that
        // implement retry SHOULD apply ±25% jitter on this value.
        console.error(
          `[credit-guard] dedup race detected but winner unresolvable for ` +
          `user=${req.userId} key=${req.idempotencyKey} loser=${jobId} — ` +
          `sending 503 so client can retry`,
        )
        void deleteJobBestEffort(jobId)
        reply.code(503).header("Retry-After", "2").send({
          error: {
            code: "dedup_race_winner_unresolvable",
            message:
              "Duplicate request detected but the canonical job could not be located. " +
              "Please retry the request — the next attempt will resolve to the canonical job. " +
              "Apply ±25% jitter to Retry-After to avoid thundering-herd retries.",
          },
        })
        return undefined
      }
      // Non-unique-violation error during backfill — non-fatal. The route
      // can still proceed; dedup is best-effort for this request.
      console.warn(
        `[credit-guard] dedup backfill failed for job ${jobId}:`,
        error.message,
      )
    }
  }
  if (!hasCredits()) return undefined
  const impl = await import("../ee/lib/credit-guard-impl.js")
  return impl.reserveCreditsForJobImpl(req, reply, jobId, modelIdentifier)
}

/**
 * Find the winner of an idempotency-key race and delete the loser. Returns
 * the winner's job id, or null if the lookup found no row OR errored.
 *
 * The `.order` clause is intentionally absent — the partial UNIQUE index
 * on `(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`
 * (migration 163) guarantees at most one row matches the filter, so
 * `.maybeSingle()` is sufficient.
 *
 * DELETE is fire-and-forget: every job-creating route enqueues BullMQ
 * AFTER calling reserveCreditsForJob, so the loser row is never the
 * target of a worker job. An orphan row would have `idempotency_key =
 * NULL` and no `usage_log_id` — the cleanup cron sweeps stale `pending`
 * jobs. Awaiting the DELETE would add a DB round-trip to the dedup-hit
 * response path for no correctness benefit.
 */
async function resolveDedupWinnerAndCleanup(
  userId: string,
  idempotencyKey: string,
  loserJobId: string,
): Promise<string | null> {
  const { data: winner, error: selectError } = await supabase
    .from("jobs")
    .select("id")
    .eq("user_id", userId)
    .eq("idempotency_key", idempotencyKey)
    .neq("id", loserJobId)
    .limit(1)
    .maybeSingle()

  if (selectError) {
    // Distinguish DB error from genuine no-row outcome — both produce a
    // null return so the caller can fall through to its error-recovery
    // path, but we want the underlying cause in logs for triage.
    console.error(
      `[credit-guard] winner SELECT failed for user=${userId} ` +
      `key=${idempotencyKey}: ${selectError.message}`,
    )
    return null
  }
  if (!winner) return null

  void deleteJobBestEffort(loserJobId)

  return winner.id as string
}

/**
 * Fire-and-forget DELETE of a jobs row. Awaits internally + checks for
 * an `error` field on the resolved value — supabase-js v2 resolves with
 * `{ data, error }` for DB-level errors (RLS, constraint, row missing)
 * and only rejects on raw network failures, so the previous
 * `.then(success, errorHandler)` form was dead code for the common DB
 * failure modes. Logs on any error path.
 *
 * Callers use `void` to opt out of awaiting — the caller's response is
 * not blocked on the delete, and the cleanup cron is the long-tail
 * backstop for orphan rows.
 */
async function deleteJobBestEffort(jobId: string): Promise<void> {
  try {
    const { error } = await supabase.from("jobs").delete().eq("id", jobId)
    if (error) {
      console.warn(
        `[credit-guard] failed to delete job ${jobId}: ${error.message}`,
      )
    }
  } catch (err) {
    // Catches raw network throws (rare in supabase-js v2 but possible).
    const detail = err instanceof Error ? err.message : String(err)
    console.warn(`[credit-guard] delete threw for job ${jobId}: ${detail}`)
  }
}
