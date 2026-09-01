import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { sendInternalError } from "../../lib/http-errors.js"
import { callerKeyHash } from "../../routes/oauth-register.js"
import { runSignupGrantClaim } from "../billing/signup-grant.js"
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
          .select("free_grant_state")
          .eq("id", userId)
          .single()

        if (profileError || !profile) {
          return sendInternalError(reply, req, profileError, CLAIM_FAILED)
        }

        const current = typeof profile.free_grant_state === "string" ? profile.free_grant_state : "unclaimed"
        // Already decided: idempotent no-op. No second signal row, no RPC.
        if (current !== "unclaimed") {
          return { state: current, granted: false }
        }

        const parsed = claimBody.safeParse(req.body ?? {})
        const keys = parsed.success ? parsed.data : {}

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
