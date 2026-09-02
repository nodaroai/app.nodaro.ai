import type { FastifyBaseLogger, FastifyInstance } from "fastify"
import { z } from "zod"
import { sendInternalError } from "../../lib/http-errors.js"
import { callerKeyHash } from "../../routes/oauth-register.js"
import { fallbackClaimDue, runSignupGrantClaim } from "../billing/signup-grant.js"
import { supabase } from "../../lib/supabase.js"

/**
 * Free-credit abuse gate: the claim endpoint.
 *
 * The 1,500-credit signup grant used to come from a column default, so nothing
 * in the application ever observed a signup. This route is the decision point
 * — it records what the account looked like, decides, and either tops the
 * balance up to the grant or withholds it. The decision itself lives in
 * `billing/signup-grant-policy.ts`; the transition in `billing/signup-grant.ts`,
 * shared with the server-side fallback on the balance read.
 *
 * BOOT-TIME, not signup-page: Google OAuth users never pass through /signup.
 * The client fires this once per page load and swallows every failure, so every
 * error path here is safe to fail open — the next boot retries.
 *
 * The response carries the STATE only, never the reasons: telling a withheld
 * account which rule caught it is a tuning guide for the next attempt.
 */

/** A SHA-256 hex digest. Lowercase only: that is what crypto.subtle produces. */
const HEX64 = /^[0-9a-f]{64}$/

/**
 * Lenient BY CONTRACT, per field.
 *
 * A fingerprint that is missing, truncated, or not a hash at all is stored as
 * NULL — it must never be a 400, and it must never block the claim.
 * `.catch(undefined)` gives each key its own verdict, so one garbage value does
 * not discard a good sibling. There is deliberately no `ip_hash` field: the
 * only way that column gets a value is `callerKeyHash`.
 *
 * Kept out of Fastify's `schema.body` on purpose — that would auto-400 a
 * malformed body before the handler ever runs.
 */
const fingerprint = z.string().regex(HEX64).optional().catch(undefined)
const claimBody = z.object({
  browserKey: fingerprint,
  deviceKey: fingerprint,
})

const CLAIM_FAILED = "Failed to claim the signup grant"

/**
 * Record the fingerprints of a keyed claim that arrived AFTER the account was
 * already decided — but only inside the grace window, and only onto a row that
 * carries no keys at all.
 *
 * WHY this exists: the balance read's keyless fallback (`settleFreeGrant` in
 * routes/credits.ts) skips the grace for any cross-origin caller,
 * on the premise that those surfaces ship no keyed claim. That premise is an
 * assumption about OTHER repos' bundles — the day one of them adds this POST,
 * its GET /v1/user/credits would land first and this handler would no-op, so
 * the keys would be thrown away. The account's own decision is one-shot and
 * stays keyless either way, but the CORPUS must not lose the observation:
 * `browser_match` / `device_cluster` score every FUTURE signup against these
 * rows, so a discarded fingerprint silently weakens the gate for everyone.
 *
 * Bounded on purpose. Only within FALLBACK_CLAIM_GRACE_MS of signup (past
 * that, an already-decided account is just a returning user booting the app,
 * which must not cost a write); and `.is(..., null)` on BOTH key columns, so
 * an existing observation is never overwritten — a claim can fill a blank, it
 * can never rewrite what was already seen. Best-effort: never fails the boot.
 */
async function backfillClaimKeys(
  log: FastifyBaseLogger,
  userId: string,
  createdAt: unknown,
  keys: { browserKey?: string; deviceKey?: string },
): Promise<void> {
  const browserKey = keys.browserKey ?? null
  const deviceKey = keys.deviceKey ?? null
  if (!browserKey && !deviceKey) return
  const created = typeof createdAt === "string" ? new Date(createdAt) : null
  if (!created || fallbackClaimDue(created)) return
  try {
    const { error } = await supabase
      .from("signup_signals")
      .update({ browser_key: browserKey, device_key: deviceKey })
      .eq("user_id", userId)
      .eq("source", "claim")
      .is("browser_key", null)
      .is("device_key", null)
    if (error) log.warn({ err: error, userId }, "signup grant: late keyed-claim backfill failed")
  } catch (err) {
    log.warn({ err, userId }, "signup grant: late keyed-claim backfill threw")
  }
}

export async function claimSignupGrantRoutes(app: FastifyInstance) {
  app.post(
    "/v1/credits/claim-signup-grant",
    {
      config: {
        // 10/min. The global limiter buckets authenticated callers by access
        // token, so this is per session, not per IP.
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      try {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("free_grant_state, created_at")
          .eq("id", userId)
          .single()

        if (profileError || !profile) {
          return sendInternalError(reply, req, profileError, CLAIM_FAILED)
        }

        const parsed = claimBody.safeParse(req.body ?? {})
        const keys = parsed.success ? parsed.data : {}

        const current = typeof profile.free_grant_state === "string" ? profile.free_grant_state : "unclaimed"
        // Already decided: idempotent no-op. No second signal row, no RPC —
        // only, inside the grace window, a blank-filling write of the keys the
        // keyless fallback could not have (see `backfillClaimKeys`).
        if (current !== "unclaimed") {
          await backfillClaimKeys(req.log, userId, profile.created_at, keys)
          return { state: current, granted: false }
        }

        const outcome = await runSignupGrantClaim(
          {
            userId,
            browserKey: keys.browserKey ?? null,
            deviceKey: keys.deviceKey ?? null,
            ipHash: callerKeyHash(req),
          },
          req.log,
        )

        return { state: outcome.state === "unclaimed" ? current : outcome.state, granted: outcome.granted }
      } catch (err) {
        return sendInternalError(reply, req, err, CLAIM_FAILED)
      }
    },
  )
}
