import type { FastifyInstance } from "fastify"
import { resolveEffectiveTier, resolveStoredTier } from "@nodaro/shared"
import { z } from "zod"
import { hasCredits } from "../../lib/config.js"
import { refusePayerBalanceToProgrammaticCaller } from "../lib/payer-balance-guard.js"
import { supabase } from "../../lib/supabase.js"

/**
 * The metadata keys a caller may see on their OWN usage_logs row.
 *
 * An ALLOWLIST, not a denylist, and that direction is the whole point: the
 * transactions route used to `select("... metadata")` and send the object
 * whole, so `display_cost` -- Nodaro's own USD valuation of the run, written by
 * reserve_credits (311_payg_web_free_pool.sql:149-157) -- went out on the wire.
 * Dividing it by `credits_used` recovers CREDIT_BASE_USD exactly. A denylist
 * would leak again the next time an RPC learns a new key; an allowlist makes a
 * new key invisible until someone decides otherwise.
 *
 * Everything here is the user's own billing mechanics, not our economics:
 *   model                        -- the model they picked (already implied by `action`)
 *   from_sub / from_topup        -- which of THEIR credit pools funded the run
 *   is_app_run / allowance_delta -- app-credit allowance movement
 *   web_free_mode / status       -- product state
 *   *_refunded                   -- addon refunds (workers/shared.ts:957, :1003)
 *
 * Deliberately absent: `display_cost` (reserve_credits' spelling, 311:151) AND
 * `display_cost_usd` (the zero-cost-reserve bypass spelling at credits.ts:2114)
 * -- two spellings of the same value, which is why a denylist would have caught
 * only one. `usage_logs.cost_usd` is a COLUMN, not a metadata key; a response
 * projection cannot reach it, which is why migration 346 revokes the table from
 * anon/authenticated in this same PR. Guarded by
 * __tests__/credits-metadata-allowlist.test.ts (no economics-shaped key may
 * ever enter this list).
 */
export const ALLOWED_TRANSACTION_METADATA_KEYS = [
  "model",
  "from_sub",
  "from_topup",
  "is_app_run",
  "allowance_delta",
  "web_free_mode",
  "status",
  "loop_trim_refunded",
  "surround_refine_refunded",
] as const

/**
 * Shape-preserving: always returns an object, so `metadata` stays a documented
 * field of the `Transaction` contract (docs/api-integration.md) and existing
 * bearer-token consumers keep parsing it -- they see a narrowed object, never a
 * vanished field. `{}` when the row has no metadata or only disallowed keys.
 */
export function projectTransactionMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const src = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of ALLOWED_TRANSACTION_METADATA_KEYS) {
    if (key in src) out[key] = src[key]
  }
  return out
}

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
      // `status` (PR9) is the reserved/committed/refunded lifecycle COLUMN
      // (019/025 migrations) — real credit-status data, not economics, so it
      // rides straight through to `rest` below like every other top-level
      // column. Distinct from `metadata.status` in the allowlist above,
      // which no INSERT actually populates.
      .select("id, created_at, credits_used, action, provider, status, metadata, workspace_id")
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

    // Project metadata BEFORE the cursor is derived -- the cursor reads
    // `created_at` off the last item, so the projection must preserve every
    // top-level column and only narrow `metadata`.
    // `payer` / `workspaceId` are top-level fields derived from the
    // `workspace_id` COLUMN, never from `metadata.payer` — the metadata
    // allowlist (economics guard) stays untouched. `workspace_id` is dropped
    // from the top level so the only public spelling is the camelCase one.
    const items = (data ?? []).map((row) => {
      const { workspace_id, ...rest } = row as Record<string, unknown> & {
        workspace_id?: string | null
      }
      return {
        ...rest,
        metadata: projectTransactionMetadata((row as { metadata?: unknown }).metadata),
        payer: workspace_id ? ("workspace" as const) : ("user" as const),
        workspaceId: workspace_id ?? null,
      }
    })
    const last = items[items.length - 1] as { created_at?: string } | undefined
    const nextCursor =
      items.length === limit && last?.created_at ? last.created_at : null
    return reply.send({ data: items, nextCursor })
  })
}
