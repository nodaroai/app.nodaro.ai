import type { FastifyInstance } from "fastify"
import { resolveEffectiveTier, resolveStoredTier } from "@nodaro/shared/credits"
import { z } from "zod"
import { hasCredits } from "../../lib/config.js"
import { refusePayerBalanceToProgrammaticCaller } from "../lib/payer-balance-guard.js"
import { supabase } from "../../lib/supabase.js"
import { listUsageTransactions, USAGE_TRANSACTIONS_PAGE_MAX } from "../../lib/usage-transactions.js"
import { SUMMARY_BUCKETS, USAGE_SUMMARY_MAX_DAYS, usageSummaryFor } from "../billing/usage-summary.js"
import { CREDIT_HISTORY_PAGE_MAX, HISTORY_KINDS, MODEL_FILTER, exportCreditHistory, listCreditHistory } from "../../lib/credit-history.js"

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

  // A timestamp, or a date alone: `2026-10-01` is that whole UTC day (its start as `from`, its end as `to`).
  const dayOrInstant = z.union([z.string().datetime({ offset: true }), z.string().date()])
  const summaryQuery = z.object({
    from: dayOrInstant.optional(),
    to: dayOrInstant.optional(),
    bucket: z.enum(SUMMARY_BUCKETS).default("day"),
  })
  const DAY_MS = 24 * 60 * 60 * 1000
  const instantOf = (value: string, edge: "start" | "end") =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z`) : new Date(value)

  // The period's usage summed the way a billing screen draws it: totals, by
  // model, by category, over time, by session and by workflow. The last 30
  // days unless `from` / `to` say otherwise; a period of at most a year.
  // ee/billing/usage-summary.ts. Under a deployment payer the totals are the
  // payer's own (what it bought and spent), so its relay credential is
  // refused like on every balance read (payer-balance-guard.ts).
  app.get("/v1/credits/usage-summary", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }
    if (refusePayerBalanceToProgrammaticCaller(req, reply)) return reply
    const parsed = summaryQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid query" },
      })
    }
    const to = parsed.data.to ? instantOf(parsed.data.to, "end") : new Date()
    const from = parsed.data.from ? instantOf(parsed.data.from, "start") : new Date(to.getTime() - 30 * DAY_MS)
    if (from.getTime() > to.getTime()) {
      return reply.status(400).send({ error: { code: "validation_error", message: "from must not be after to" } })
    }
    if (to.getTime() - from.getTime() > USAGE_SUMMARY_MAX_DAYS * DAY_MS) {
      return reply.status(400).send({ error: { code: "validation_error", message: `The period is at most ${USAGE_SUMMARY_MAX_DAYS} days` } })
    }

    const report = (table: string, message: string) => req.log.error({ table, message }, "credits/usage-summary side read failed")
    const summary = await usageSummaryFor(req.userId, { from: from.toISOString(), to: to.toISOString(), bucket: parsed.data.bucket }, report)
    if ("error" in summary) {
      req.log.error({ err: summary.error }, "credits/usage-summary lookup failed")
      return reply.status(500).send({ error: { code: "internal_error", message: "Lookup failed" } })
    }
    return reply.send({ data: summary })
  })

  const historyQuery = z.object({
    limit: z.coerce.number().int().min(1).max(CREDIT_HISTORY_PAGE_MAX).default(50),
    cursor: z.string().max(80).optional(),
    kind: z.enum(HISTORY_KINDS).optional(),
    model: z.string().regex(MODEL_FILTER, "model is a model identifier").optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    q: z.string().min(1).max(120).optional(),
    format: z.enum(["json", "csv"]).default("json"),
  })

  // Every movement of the person's balance, newest first — runs, purchases,
  // grants, refunds, adjustments, expiries — with the balance after each one;
  // a job's reserve row carries its model, charge and job. `format=csv` is
  // the whole filtered history as a file (no paging). lib/credit-history.ts.
  // Every row carries a balance, so the payer's relay credential is refused
  // like on every balance read (payer-balance-guard.ts).
  app.get("/v1/credits/history", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }
    if (refusePayerBalanceToProgrammaticCaller(req, reply)) return reply
    const parsed = historyQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid query",
        },
      })
    }
    const { limit, cursor, format, ...filters } = parsed.data
    const report = (table: string, message: string) => req.log.error({ table, message }, "credits/history enrichment read failed")

    if (format === "csv") {
      const exported = await exportCreditHistory(req.userId, filters, report)
      if ("error" in exported) {
        req.log.error({ err: exported.error }, "credits/history export failed")
        return reply.status(500).send({ error: { code: "internal_error", message: "Lookup failed" } })
      }
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", 'attachment; filename="credit-history.csv"')
        .send(exported.csv)
    }

    const listed = await listCreditHistory(req.userId, filters, { limit, cursor }, report)
    if ("badCursor" in listed) {
      return reply.status(400).send({ error: { code: "validation_error", message: "cursor is not one this route gave" } })
    }
    if ("error" in listed) {
      req.log.error({ err: listed.error }, "credits/history lookup failed")
      return reply.status(500).send({ error: { code: "internal_error", message: "Lookup failed" } })
    }
    return reply.send({ data: listed.items, nextCursor: listed.nextCursor })
  })
}
