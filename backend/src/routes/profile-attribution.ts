import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { sendInternalError } from "../lib/http-errors.js"

/**
 * POST /v1/profile/attribution — record the marketing channel a user first
 * arrived from. FIRST TOUCH WINS: the write is conditional on the column still
 * being NULL, so a later call (a second device, a re-visit through a different
 * campaign) reports `stored: false` and changes nothing.
 *
 * WHY THE CLIENT SUPPLIES THE VALUE: the channel is only knowable in the
 * browser, on the landing page, BEFORE the Google OAuth round-trip — which
 * destroys both the query string and the referrer. By the time a user exists,
 * the server can no longer observe where they came from; naive server-side
 * attribution would report "google.com" for 100% of signups.
 *
 * WHY A ROUTE AND NOT A DIRECT POSTGREST UPDATE: the first-touch-wins invariant
 * has to live somewhere the client cannot skip. `profiles`' UPDATE policy is a
 * denylist (migration 025) covering the credit/role columns, so a new column is
 * client-writable by default and a client could otherwise rewrite its own
 * attribution at will.
 *
 * TRUST BOUNDARY: the value is still self-reported by an authenticated user, so
 * it is spoofable one-write-per-account. That is acceptable for a metric that
 * is always cross-checked against an independent source (Cloudflare's referrer
 * report) before a decision is made on it — but it must never be treated as
 * tamper-proof. Rate-limited to blunt scripted abuse.
 *
 * `stored: false` is a NORMAL outcome, not an error — clients must not retry on it.
 */
const bodySchema = z.object({
  // Same slug grammar the client normalizes to; anything else is a client bug.
  // Anchored and length-bounded — no backtracking, so no ReDoS surface.
  channel: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
})

export async function profileAttributionRoutes(app: FastifyInstance) {
  app.post(
    "/v1/profile/attribution",
    // Auth comes from the GLOBAL preHandler (middleware/auth.ts, registered in
    // app.ts before every route): default-deny with a PUBLIC_ROUTES whitelist
    // this path is not on, so `req.userId` is always a verified identity here.
    // Rate limiting is opt-in per route (`global: false` in app.ts) — without
    // this, every POST is an unbounded authenticated UPDATE on profiles.
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      const parsed = bodySchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "invalid_channel",
            message: "channel must match ^[a-z0-9][a-z0-9-]{0,39}$",
          },
        })
      }

      // `.eq(id)` is the ONLY tenant scope: this client is service-role and
      // bypasses RLS, so a user can never touch another user's attribution.
      // `.is(null)` makes the write first-touch-wins and race-safe.
      const { data, error } = await supabase
        .from("profiles")
        .update({
          first_touch_channel: parsed.data.channel,
          first_touch_at: new Date().toISOString(),
        })
        .eq("id", userId)
        .is("first_touch_channel", null)
        .select("id")

      if (error) {
        return sendInternalError(reply, req, new Error(error.message), "Failed to store attribution")
      }

      const stored = Array.isArray(data) && data.length > 0
      // Observability: during launch week "nobody arrived with a channel" and
      // "the endpoint has been failing since Tuesday" look identical in the
      // data, because `direct` is an expected-majority answer. This line is how
      // you tell them apart.
      if (stored) {
        req.log.info({ channel: parsed.data.channel }, "attribution stored")
      }
      return { stored }
    },
  )
}
