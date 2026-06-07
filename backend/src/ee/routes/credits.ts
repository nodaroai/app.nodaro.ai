import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { CreditsService } from "../services/credits.js"
import { supabase } from "../../lib/supabase.js"
import { formatZodError } from "../../lib/zod-error.js"
import { handlePriceNotConfigured } from "../lib/credit-guard-impl.js"
import { PriceNotConfiguredError } from "../billing/credits.js"

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
      const balance = await CreditsService.getBalance(userId)
      setCachedBalance(userId, balance)
      return { data: balance }
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
      const result = await CreditsService.reserveCredits(
        userId,
        jobId,
        modelIdentifier,
        providerCostUsd,
        displayCostUsd
      )
      invalidateBalanceCache(userId)
      return { data: result }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to reserve credits"
      console.error("[credits] Failed to reserve credits:", error)
      return reply.status(400).send({
        error: { code: "insufficient_credits", message },
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
      .from("usage_logs")
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
      .from("usage_logs")
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
      return { data: { totalCredits, nodeCount: nodes.length } }
    } catch (error) {
      console.error("[credits] Failed to estimate workflow:", error)
      return reply.status(500).send({
        error: { code: "internal_error", message: "Failed to estimate workflow" },
      })
    }
  })
}
