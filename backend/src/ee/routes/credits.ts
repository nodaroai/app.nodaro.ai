import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { openApiRegistry } from "../../lib/openapi-registry.js"
import { mapReserveError } from "../../lib/reserve-errors.js"
import { billingService } from "../../lib/billing-context.js"
import { z as zOpenApi } from "zod"
import { z } from "zod"
import { CreditsService } from "../services/credits.js"
import { supabase } from "../../lib/supabase.js"
import { formatZodError } from "../../lib/zod-error.js"
import { handlePriceNotConfigured } from "../lib/credit-guard-impl.js"
import { PriceNotConfiguredError, type UserBalance } from "../billing/credits.js"
import { callerKeyHash } from "../../routes/oauth-register.js"
import { config } from "../../lib/config.js"
import { firstHeaderValue } from "../../lib/request-helpers.js"
import { fallbackClaimDue, isForeignOrigin, readFreeGrant, runSignupGrantClaim } from "../billing/signup-grant.js"

/**
 * Resolve the account's free-grant state for the balance read, claiming on
 * the spot when it is still 'unclaimed'. `undefined` when the column is not
 * there yet (dormant) or anything failed — the balance read must not care.
 *
 * An 'unclaimed' account is settled in one of two ways, decided by WHO asked:
 *
 * 1. Our own page (no Origin on a same-origin GET, or our own origin), or no
 *    Origin at all: wait out FALLBACK_CLAIM_GRACE_MS so the app.nodaro.ai
 *    SPA's keyed boot-time POST can decide with the fingerprints.
 * 2. Any other origin — the thin clients (studio / person / recast / voice),
 *    the browser extension, anything cross-origin: those surfaces have no
 *    claim call, and a cross-origin caller could not send fingerprints anyway.
 *    No keyed claim is ever coming, so claim NOW — the grace would only strand
 *    the account at zero credits until it next polls, which a user who leaves
 *    never does. A forged Origin buys a curl nothing it did not already have
 *    (see `isForeignOrigin`). Should a thin client ever grow its own keyed
 *    claim, `backfillClaimKeys` (claim-signup-grant.ts) keeps the late
 *    fingerprints out of the bin.
 */
async function settleFreeGrant(
  userId: string,
  req: FastifyRequest,
): Promise<{ state: "unclaimed" | "granted" | "withheld"; moved: boolean } | undefined> {
  try {
    const grant = await readFreeGrant(userId)
    if (!grant) return undefined
    if (grant.state !== "unclaimed") return { state: grant.state, moved: false }
    const origin = firstHeaderValue(req.headers.origin)
    const foreign = isForeignOrigin({
      origin,
      publicUrl: config.PUBLIC_URL,
      host: firstHeaderValue(req.headers.host),
      forwardedHost: firstHeaderValue(req.headers["x-forwarded-host"]),
    })
    // Fresh account on our own page: the keyed claim may still be coming.
    if (!foreign && !fallbackClaimDue(grant.createdAt)) return { state: "unclaimed", moved: false }
    const outcome = await runSignupGrantClaim(
      { userId, browserKey: null, deviceKey: null, ipHash: callerKeyHash(req) },
      req.log,
    )
    if (foreign) {
      // The host only — never the raw caller IP, which is what ipHash exists for.
      req.log.info(
        { userId, originHost: originHostOf(origin), state: outcome.state },
        "free grant claimed keyless for a cross-origin client",
      )
    }
    return { state: outcome.state, moved: outcome.granted }
  } catch (err) {
    req.log.warn({ err, userId }, "free grant fallback claim failed")
    return undefined
  }
}

/** Loggable host of an Origin header, or `undefined` when it is not a URL. */
function originHostOf(origin: string | undefined): string | undefined {
  if (!origin) return undefined
  try {
    return new URL(origin).host
  } catch {
    return undefined
  }
}

/**
 * Internal-only gate for the credit-mutation routes (/reserve, /commit, /refund).
 * They mutate balances directly with NO job-status check (they trust the worker
 * lifecycle), so only the internal orchestrator (via the shared secret, which sets
 * req.isInternalCall) may call them — a user JWT / API token must NOT, else a user
 * could refund/zero their own reservation mid-job (the worker's later commit then
 * CAS-no-ops) → free generations. Returns true (+ sends 403) when not internal; the
 * handler must `return`.
 */
function requireInternalCall(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!req.isInternalCall) {
    reply.status(403).send({ error: { code: "forbidden", message: "Internal endpoint" } })
    return true
  }
  return false
}

const modelCostsBody = z.object({
  models: z.array(z.string().min(1)).min(1).max(50),
})

const reserveBody = z.object({
  jobId: z.string().min(1),
  modelIdentifier: z.string().min(1),
  providerCostUsd: z.number().min(0).optional(),
  displayCostUsd: z.number().min(0).optional(),
})

const commitBody = z.object({
  usageLogId: z.string().min(1),
  actualCredits: z.number().min(0).optional(),
})

const refundBody = z.object({
  usageLogId: z.string().min(1),
})

const estimateWorkflowBody = z.object({
  nodes: z.array(z.object({
    type: z.string().min(1),
    data: z.record(z.string(), z.unknown()).optional(),
  })),
  /** P14/W8 — lets the billing hook resolve the payer for this estimate
   *  (rung 1 runs the workflow's own run predicate; a viewer of a shared
   *  workflow never reaches the workspace branch, so budget numbers stay
   *  member-only). */
  workflowId: z.string().uuid().optional(),
})

// ============================================================
// Credits Routes
// ============================================================

// In-memory cache for credit balance (keyed by userId)
const BALANCE_CACHE_TTL_MS = 15_000 // 15 seconds
const balanceCache = new Map<string, { data: unknown; expiry: number }>()

function getCachedBalance(userId: string): unknown | null {
  const entry = balanceCache.get(userId)
  if (!entry) return null
  if (Date.now() > entry.expiry) {
    balanceCache.delete(userId)
    return null
  }
  return entry.data
}

function setCachedBalance(userId: string, data: unknown): void {
  balanceCache.set(userId, { data, expiry: Date.now() + BALANCE_CACHE_TTL_MS })
  if (balanceCache.size > 10_000) {
    const now = Date.now()
    for (const [k, v] of balanceCache) {
      if (now > v.expiry) balanceCache.delete(k)
    }
  }
}

/** Invalidate cached balance for a user (call after credit mutations) */
export function invalidateBalanceCache(userId: string): void {
  balanceCache.delete(userId)
}

export async function creditsRoutes(app: FastifyInstance) {
  // Registered inside the route function so the path only appears in the
  // OpenAPI doc on editions where the route actually exists (Cloud).
  openApiRegistry.registerPath({
    method: "post", path: "/v1/credits/model-costs",
    description: "Batch credit-cost lookup for model identifiers (max 50 per request).",
    security: [{ bearerAuth: [] }],
    request: { body: { content: { "application/json": { schema: zOpenApi.object({ models: zOpenApi.array(zOpenApi.string()).max(50) }) } } } },
    responses: { 200: { description: "Costs by identifier", content: { "application/json": { schema: zOpenApi.object({
      data: zOpenApi.record(zOpenApi.string(), zOpenApi.number()),
      missing: zOpenApi.array(zOpenApi.string()),
      errors: zOpenApi.array(zOpenApi.string()),
    }) } } } },
  })
  /**
   * GET /v1/user/credits
   * Get current user's credit balance and tier info
   */
  app.get("/v1/user/credits", async (req, reply) => {
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const cached = getCachedBalance(userId)
    if (cached) {
      return { data: cached }
    }

    try {
      let balance = await CreditsService.getBalance(userId)

      // Free-grant fallback. The boot-time claim lives in the app.nodaro.ai
      // browser bundle, so two kinds of caller never send it: a tab running a
      // build from before the gate, and every cross-origin thin client. Once
      // the signup default is zero, such a user sits at zero credits. Every
      // client reads its balance, so this is where an 'unclaimed' account gets
      // its decision made regardless of bundle — after the grace by default,
      // immediately for any other origin (settleFreeGrant).
      // Arrives with no fingerprints; the policy scores what it has.
      // Best-effort end to end: nothing here may break a balance read.
      const grant = await settleFreeGrant(userId, req)
      if (grant?.moved) balance = await CreditsService.getBalance(userId)
      const data: UserBalance = grant ? { ...balance, freeGrantState: grant.state } : balance

      setCachedBalance(userId, data)
      return { data }
    } catch (error) {
      console.error("[credits] Failed to get balance:", error)
      return reply.status(500).send({
        error: { code: "internal_error", message: "Failed to get balance" },
      })
    }
  })

  /**
   * GET /v1/credits/check
   * Check if user has sufficient credits for a specific model
   */
  app.get<{
    Querystring: { model: string }
  }>("/v1/credits/check", async (req, reply) => {
    const userId = req.userId
    const { model } = req.query

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    if (!model) {
      return reply.status(400).send({
        error: { code: "bad_request", message: "model is required" },
      })
    }

    try {
      const result = await CreditsService.checkCredits(userId, model)
      const creditCost = await CreditsService.getModelCreditCost(model)

      return {
        data: {
          ...result,
          creditCost,
        },
      }
    } catch (error) {
      if (handlePriceNotConfigured(error, reply, "GET /v1/credits/check")) return
      console.error("[credits] Failed to check credits:", error)
      return reply.status(500).send({
        error: { code: "internal_error", message: "Failed to check credits" },
      })
    }
  })

  /**
   * GET /v1/credits/model-cost
   * Get credit cost for a specific model
   */
  app.get<{
    Querystring: { model: string }
  }>("/v1/credits/model-cost", async (req, reply) => {
    const { model } = req.query

    if (!model) {
      return reply.status(400).send({
        error: { code: "bad_request", message: "model is required" },
      })
    }

    try {
      const creditCost = await CreditsService.getModelCreditCost(model)
      reply.header("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
      return reply.send({ data: { model, creditCost } })
    } catch (error) {
      if (handlePriceNotConfigured(error, reply, "GET /v1/credits/model-cost")) return
      console.error("[credits] Failed to get model cost:", error)
      return reply.status(500).send({
        error: { code: "internal_error", message: "Failed to get model cost" },
      })
    }
  })

  /**
   * POST /v1/credits/model-costs
   * Batch lookup for editor cost previews. Returns the subset of models with
   * a known price + a list of identifiers that have no pricing row.
   *
   * Per-model fault isolation (Promise.allSettled): one unpriced identifier
   * cannot 503 the whole batch and take down the editor's cost panel. The
   * hard-fail policy still triggers at credit-guard reservation time when the
   * user actually runs the node — that's the intended user-facing gate, not
   * the editor preview lookup.
   */
  app.post("/v1/credits/model-costs", async (req, reply) => {
    const parsed = modelCostsBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }
    const { models } = parsed.data

    const results = await Promise.allSettled(
      models.map(async (model) => {
        const cost = await CreditsService.getModelCreditCost(model)
        return { model, cost }
      }),
    )

    const costs: Record<string, number> = {}
    const missing: string[] = []
    const otherErrors: string[] = []

    for (let i = 0; i < results.length; i++) {
      const r = results[i]!
      if (r.status === "fulfilled") {
        costs[r.value.model] = r.value.cost
        continue
      }
      const id = models[i]!
      if (r.reason instanceof PriceNotConfiguredError) {
        missing.push(id)
        continue
      }
      otherErrors.push(id)
      console.error(`[credits] model-costs lookup failed for "${id}":`, r.reason)
    }

    if (missing.length > 0) {
      console.warn(
        `[credits] model-costs: ${missing.length} unpriced identifier(s): ${missing.join(", ")}`,
      )
    }

    return { data: costs, missing, errors: otherErrors }
  })

  /**
   * POST /v1/credits/reserve
   * Reserve credits for a job (internal use)
   */
  app.post("/v1/credits/reserve", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    if (requireInternalCall(req, reply)) return

    const parsed = reserveBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }
    const { jobId, modelIdentifier, providerCostUsd = 0, displayCostUsd = 0 } = parsed.data

    try {
      // P14/W4f: the caller forwards the validated workspace header — the
      // billing hook resolved it into req.billingContext (rung 2, internal
      // lane) — and NO body field exists on purpose: a body would be a
      // second, weaker door beside the header-validated one.
      const result = await CreditsService.reserveCredits(
        userId,
        jobId,
        modelIdentifier,
        providerCostUsd,
        displayCostUsd,
        { billingContext: req.billingContext }
      )
      invalidateBalanceCache(userId)
      return { data: result }
    } catch (error) {
      console.error("[credits] Failed to reserve credits:", error)
      // P14/W3: workspace refusals answer their stable code; everything else
      // keeps the legacy shape with a FIXED message (the raw text carried
      // interpolated ids/amounts and belongs in the log line above).
      const mapped = mapReserveError(error)
      if (mapped) {
        return reply.status(mapped.status).send({ error: { code: mapped.code, message: mapped.message } })
      }
      return reply.status(400).send({
        error: { code: "insufficient_credits", message: "Failed to reserve credits" },
      })
    }
  })

  /**
   * POST /v1/credits/commit
   * Commit reserved credits after job success (internal use)
   */
  app.post("/v1/credits/commit", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    if (requireInternalCall(req, reply)) return

    const parsed = commitBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }
    const { usageLogId, actualCredits } = parsed.data

    // Verify the usage log belongs to the requesting user
    const { data: log } = await supabase
      .from("usage_logs") // tenant-scope-ignore: ownership verified post-fetch (403 below)
      .select("user_id")
      .eq("id", usageLogId)
      .single()

    if (!log || log.user_id !== userId) {
      return reply.status(403).send({
        error: { code: "forbidden", message: "Usage log does not belong to you" },
      })
    }

    try {
      await CreditsService.commitCredits(usageLogId, actualCredits)
      return { success: true }
    } catch (error) {
      console.error("[credits] Failed to commit credits:", error)
      return reply.status(500).send({
        error: { code: "internal_error", message: "Failed to commit credits" },
      })
    }
  })

  /**
   * POST /v1/credits/refund
   * Refund reserved credits after job failure (internal use)
   */
  app.post("/v1/credits/refund", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    if (requireInternalCall(req, reply)) return

    const parsed = refundBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }
    const { usageLogId } = parsed.data

    // Verify the usage log belongs to the requesting user
    const { data: log } = await supabase
      .from("usage_logs") // tenant-scope-ignore: ownership verified post-fetch (403 below)
      .select("user_id")
      .eq("id", usageLogId)
      .single()

    if (!log || log.user_id !== userId) {
      return reply.status(403).send({
        error: { code: "forbidden", message: "Usage log does not belong to you" },
      })
    }

    try {
      await CreditsService.refundCredits(usageLogId)
      return { success: true }
    } catch (error) {
      console.error("[credits] Failed to refund credits:", error)
      return reply.status(500).send({
        error: { code: "internal_error", message: "Failed to refund credits" },
      })
    }
  })

  /**
   * POST /v1/credits/estimate-workflow
   * Estimate total credits for a workflow
   */
  app.post("/v1/credits/estimate-workflow", async (req, reply) => {
    const parsed = estimateWorkflowBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }
    const { nodes } = parsed.data

    try {
      const totalCredits = CreditsService.estimateWorkflowCredits(nodes)
      // P14/W8: the payer-aware half. The billing hook already resolved this
      // request's payer (rung 1 via the body's workflowId — which required
      // the run predicate — or rung 2 via the validated workspace header),
      // so the answer is read, never re-derived. Personal answers are
      // byte-identical to pre-P14 plus the explicit payer field.
      const ctx = req.billingContext
      if (ctx?.payer !== "workspace") {
        return { data: { totalCredits, nodeCount: nodes.length, payer: "user" } }
      }
      // Budget preview through the plugin's ONE headroom formula, reached
      // through the SAME gated seam accessor as every resolve (flag +
      // member probe); an older plugin (no member) degrades to "workspace
      // pays — no preview". A FAILURE degrades the same way but is logged —
      // a permanently broken formula must not be indistinguishable from an
      // older plugin.
      const billing = billingService()
      const preview = billing?.headroom
        ? await billing.headroom(ctx.workspaceId, ctx.userId).catch((err: Error) => {
            console.error("[credits] headroom preview failed for workspace " + ctx.workspaceId + ":", err.message)
            return null
          })
        : null
      return {
        data: {
          totalCredits,
          nodeCount: nodes.length,
          payer: "workspace",
          workspaceId: ctx.workspaceId,
          memberCap: ctx.memberCap,
          headroomCredits: preview?.headroomCredits ?? null,
          ...(preview?.workspaceLabel ? { workspaceLabel: preview.workspaceLabel } : {}),
        },
      }
    } catch (error) {
      console.error("[credits] Failed to estimate workflow:", error)
      return reply.status(500).send({
        error: { code: "internal_error", message: "Failed to estimate workflow" },
      })
    }
  })
}
