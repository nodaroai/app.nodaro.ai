import type { FastifyInstance } from "fastify"
import { resolveEffectiveTier, resolveStoredTier } from "@nodaro/shared"
import { z } from "zod"
import { hasCredits } from "../../lib/config.js"
import { refusePayerBalanceToProgrammaticCaller } from "../lib/payer-balance-guard.js"
import { supabase } from "../../lib/supabase.js"
import { listUsageTransactions, USAGE_TRANSACTIONS_PAGE_MAX } from "../../lib/usage-transactions.js"

// The allowlist and the usage rows' projection live in core (lib/usage-transactions.ts)
// so the MCP `credit_transactions` tool lists the same rows this route does.
export { ALLOWED_TRANSACTION_METADATA_KEYS, projectTransactionMetadata } from "../../lib/usage-transactions.js"

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
    // A deployment payer's pool is the OPERATOR's number. The payer-aware 402
    // already refuses to echo it (credit-guard-impl.ts:238-255) because that
    // response reaches anyone who can press Generate; this route is the other
    // door to the same figure, and a relay credential authenticates AS the
    // payer. `/v1/nodaro-connect/status` proxies this route straight onto a
    // connected instance's Integrations card (routes/nodaro-connect.ts:231-238),
    // so without this the operator's real balance prints on every relaying
    // near end. Identity-scoped, not credential-scoped: an ordinary requester's
    // token is unaffected, and the payer's own browser session still answers.
    // Refused BEFORE the profile read -- the leak closes without a query.
    // INERT with no payer configured: deploymentPayerActive() is false, so this
    // whole condition short-circuits and the route behaves as it always has.
    // Shared with the two sibling doors onto the same figure —
    // `GET /v1/user/credits` and `GET /v1/credits/check` (ee/routes/credits.ts).
    if (refusePayerBalanceToProgrammaticCaller(req, reply)) return reply
    const { data, error } = await supabase
      .from("profiles")
      .select("subscription_credits, topup_credits, tier, subscription_tier, lifetime_topup_credits")
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
      // Stored tier kept for back-compat; display should use effectiveTier
      // (must agree with getBalance's fields or the two balance surfaces
      // disagree in the UI).
      tier: resolveStoredTier({
        tier: data.tier ?? null,
        subscription_tier: data.subscription_tier ?? null,
      }),
      effectiveTier: resolveEffectiveTier({
        tier: data.tier ?? null,
        subscription_tier: data.subscription_tier ?? null,
        lifetime_topup_credits: (data.lifetime_topup_credits as number) ?? 0,
      }),
    })
  })

  const txQuery = z.object({
    limit: z.coerce.number().int().min(1).max(USAGE_TRANSACTIONS_PAGE_MAX).default(20),
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

    // The rows, their amounts (`credits_charged` through the one charge
    // reader beside the `credits_used` hold) and the metadata allowlist:
    // lib/usage-transactions.ts, shared with the MCP `credit_transactions` tool.
    const listed = await listUsageTransactions(req.userId, { limit, cursor })
    if ("error" in listed) {
      req.log.error({ err: listed.error }, "credits/transactions lookup failed")
      return reply.status(500).send({
        error: { code: "internal_error", message: "Lookup failed" },
      })
    }
    const { items, nextCursor } = listed
    return reply.send({ data: items, nextCursor })
  })
}
