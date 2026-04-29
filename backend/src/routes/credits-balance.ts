import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { hasCredits } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"

/**
 * Net-new credit routes for the MCP `check_balance` and `credit_transactions`
 * tools — also useful for non-MCP API consumers that just want a flat balance
 * payload without the kitchen-sink shape from `GET /v1/user/credits`.
 *
 * Both routes are cloud-only (gated by `hasCredits()`); on community/business
 * editions they aren't registered, so the caller sees a clean 404.
 *
 * Auth: relies on the existing `registerAuthHook` to populate `req.userId`.
 * The MCP tool flow (token-based OAuth) and the JWT flow both end up at the
 * same `req.userId`, so no special-case logic is needed here.
 *
 * Note on parity with the in-process MCP path: the `check_balance` /
 * `credit_transactions` MCP tools currently query supabase directly (via
 * `CreditsService.getBalance()` and a direct `transactions` lookup) because
 * a GET via `app.inject()` has no body for the internal-orchestrator-secret
 * flow to read `userId` from. These routes give the same data shape over
 * HTTP for external API consumers.
 */
export async function registerCreditsBalanceRoutes(app: FastifyInstance): Promise<void> {
  if (!hasCredits()) return

  app.get("/v1/credits/balance", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }
    const { data, error } = await supabase
      .from("profiles")
      .select("subscription_credits, topup_credits, tier")
      .eq("id", req.userId)
      .maybeSingle()
    if (error) {
      req.log.error({ err: error }, "credits/balance lookup failed")
      return reply.status(500).send({
        error: { code: "internal_error", message: "Lookup failed" },
      })
    }
    if (!data) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Profile not found" },
      })
    }

    const subscription = Number(data.subscription_credits ?? 0)
    const topup = Number(data.topup_credits ?? 0)
    return reply.send({
      total: subscription + topup,
      subscription,
      topup,
      tier: data.tier ?? "free",
    })
  })

  const txQuery = z.object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().optional(),
  })

  app.get("/v1/credits/transactions", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }
    const parsed = txQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid query",
        },
      })
    }
    const { limit, cursor } = parsed.data

    let query = supabase
      .from("usage_logs")
      .select("id, created_at, credits_used, action, provider, metadata")
      .eq("user_id", req.userId)
      .order("created_at", { ascending: false })
      .limit(limit)
    if (cursor) query = query.lt("created_at", cursor)
    const { data, error } = await query

    if (error) {
      req.log.error({ err: error }, "credits/transactions lookup failed")
      return reply.status(500).send({
        error: { code: "internal_error", message: "Lookup failed" },
      })
    }

    const items = data ?? []
    const last = items[items.length - 1] as { created_at?: string } | undefined
    const nextCursor =
      items.length === limit && last?.created_at ? last.created_at : null
    return reply.send({ data: items, nextCursor })
  })
}
