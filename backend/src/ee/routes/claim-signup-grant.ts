import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { callerKeyHash } from "../../routes/oauth-register.js"
import { CreditsService } from "../billing/credits.js"
import { TIER_CREDITS } from "../billing/stripe-config.js"
import { invalidateBalanceCache } from "./credits.js"

/**
 * Free-credit abuse gate, PR 1: the claim endpoint.
 *
 * The 1,500-credit signup grant has always come from a column default, so
 * nothing in the application ever observed a signup. This route is the decision
 * point — it records what the account looked like, marks the grant claimed, and
 * tops the balance up to the grant. While the old column default still stands
 * the top-up is a no-op; it is written now anyway so PR 2's non-atomic
 * migrate-then-deploy window cannot strand a signup at zero credits.
 *
 * BOOT-TIME, not signup-page: Google OAuth users never pass through /signup.
 * The client fires this once per page load and swallows every failure, so every
 * error path here is safe to fail open — the next boot retries.
 */

/** A SHA-256 hex digest. Lowercase only: that is what crypto.subtle produces. */
const HEX64 = /^[0-9a-f]{64}$/

/**
 * Lenient BY CONTRACT, per field.
 *
 * A fingerprint that is missing, truncated, or not a hash at all is itself a
 * risk signal for PR 2's scoring — it must never be a 400, and it must never
 * block the claim. `.catch(undefined)` gives each key its own verdict, so one
 * garbage value does not discard a good sibling. There is deliberately no
 * `ip_hash` field: the only way that column gets a value is `callerKeyHash`.
 *
 * Kept out of Fastify's `schema.body` on purpose — that would auto-400 a
 * malformed body before the handler ever runs.
 */
const fingerprint = z.string().regex(HEX64).optional().catch(undefined)
const claimBody = z.object({
  browserKey: fingerprint,
  deviceKey: fingerprint,
})

/** Shape of one `claim_signup_grant` row. */
interface ClaimResult {
  did_claim?: boolean
  old_credits?: number
  new_credits?: number
  state?: string
}

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
        // Already decided ('granted', or 'withheld' once PR 2 can set it):
        // idempotent no-op. No second signal row, no RPC.
        if (current !== "unclaimed") {
          return { state: current, granted: false }
        }

        const parsed = claimBody.safeParse(req.body ?? {})
        const keys = parsed.success ? parsed.data : {}

        // Best-effort: a signal we failed to store is a worse observation, not
        // a reason to withhold credits from a legitimate signup.
        const { error: signalError } = await supabase.from("signup_signals").upsert(
          {
            user_id: userId,
            browser_key: keys.browserKey ?? null,
            device_key: keys.deviceKey ?? null,
            ip_hash: callerKeyHash(req),
            source: "claim",
          },
          { onConflict: "user_id,source", ignoreDuplicates: true },
        )
        if (signalError) {
          req.log.warn({ err: signalError, userId }, "signup signal insert failed")
        }

        const { data: claimed, error: rpcError } = await supabase.rpc("claim_signup_grant", {
          p_user_id: userId,
          p_grant_amount: TIER_CREDITS.free,
        })
        if (rpcError) {
          return sendInternalError(reply, req, rpcError, CLAIM_FAILED)
        }

        // A `RETURNS TABLE` function reaches PostgREST as an array of rows.
        const row: ClaimResult | null =
          (Array.isArray(claimed) ? (claimed[0] as ClaimResult | undefined) : (claimed as ClaimResult | null)) ?? null

        const before = Number(row?.old_credits ?? 0)
        const after = Number(row?.new_credits ?? 0)

        // Only a balance that actually moved earns a ledger row. With the old
        // signup default still in place it never does.
        if (after > before) {
          await CreditsService.logTransaction({
            userId,
            amount: after - before,
            creditType: "subscription",
            source: "signup_grant",
            description: "Free signup grant",
            balanceAfter: after,
          })
          invalidateBalanceCache(userId)
        }

        return {
          state: typeof row?.state === "string" ? row.state : current,
          granted: row?.did_claim === true,
        }
      } catch (err) {
        return sendInternalError(reply, req, err, CLAIM_FAILED)
      }
    },
  )
}
