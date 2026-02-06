import type { FastifyInstance } from "fastify"
import { CreditsService } from "./credits.js"

// ============================================================
// Credits Routes
// ============================================================

export async function creditsRoutes(app: FastifyInstance) {
  /**
   * GET /v1/user/credits
   * Get current user's credit balance and tier info
   */
  app.get<{
    Querystring: { userId: string }
  }>("/v1/user/credits", async (req, reply) => {
    const { userId } = req.query

    if (!userId) {
      return reply.status(400).send({
        error: { code: "bad_request", message: "userId is required" },
      })
    }

    try {
      const balance = await CreditsService.getBalance(userId)
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
    Querystring: { userId: string; model: string }
  }>("/v1/credits/check", async (req, reply) => {
    const { userId, model } = req.query

    if (!userId || !model) {
      return reply.status(400).send({
        error: { code: "bad_request", message: "userId and model are required" },
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
      return { data: { model, creditCost } }
    } catch (error) {
      console.error("[credits] Failed to get model cost:", error)
      return reply.status(500).send({
        error: { code: "internal_error", message: "Failed to get model cost" },
      })
    }
  })

  /**
   * POST /v1/credits/reserve
   * Reserve credits for a job (internal use)
   */
  app.post<{
    Body: {
      userId: string
      jobId: string
      modelIdentifier: string
      providerCostUsd?: number
      displayCostUsd?: number
    }
  }>("/v1/credits/reserve", async (req, reply) => {
    const { userId, jobId, modelIdentifier, providerCostUsd = 0, displayCostUsd = 0 } = req.body

    if (!userId || !jobId || !modelIdentifier) {
      return reply.status(400).send({
        error: { code: "bad_request", message: "userId, jobId, and modelIdentifier are required" },
      })
    }

    try {
      const result = await CreditsService.reserveCredits(
        userId,
        jobId,
        modelIdentifier,
        providerCostUsd,
        displayCostUsd
      )
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
  app.post<{
    Body: {
      usageLogId: string
      actualCredits?: number
    }
  }>("/v1/credits/commit", async (req, reply) => {
    const { usageLogId, actualCredits } = req.body

    if (!usageLogId) {
      return reply.status(400).send({
        error: { code: "bad_request", message: "usageLogId is required" },
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
  app.post<{
    Body: {
      usageLogId: string
    }
  }>("/v1/credits/refund", async (req, reply) => {
    const { usageLogId } = req.body

    if (!usageLogId) {
      return reply.status(400).send({
        error: { code: "bad_request", message: "usageLogId is required" },
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
  app.post<{
    Body: {
      nodes: Array<{ type: string }>
    }
  }>("/v1/credits/estimate-workflow", async (req, reply) => {
    const { nodes } = req.body

    if (!nodes || !Array.isArray(nodes)) {
      return reply.status(400).send({
        error: { code: "bad_request", message: "nodes array is required" },
      })
    }

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
