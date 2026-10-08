import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { requirePlatformOperator } from "../middleware/require-platform-operator.js"
import { LLM_MODELS, LLM_FEATURE_DEFAULTS, LLM_CREDIT_RUNGS, llmCreditIdForRung, llmTierCreditIds } from "@nodaro/shared"
import type { LlmCreditRung, LlmFeature } from "@nodaro/shared"
/** Derive credit features from the shared LlmFeature type (single source of truth) */
const LLM_CREDIT_FEATURES = Object.keys(LLM_FEATURE_DEFAULTS) as LlmFeature[]

const toggleBody = z.object({
  isEnabled: z.boolean(),
})

export async function adminLlmModelsRoutes(app: FastifyInstance) {
  // GET /v1/admin/llm-models — list all LLM models merged with DB pricing
  app.get("/v1/admin/llm-models", { preHandler: requireAdmin }, async (_req, reply) => {
    const modelIds = LLM_MODELS.map((m) => m.id)
    const featurePatterns = LLM_CREDIT_FEATURES.flatMap((f) => llmTierCreditIds(f))
    const allIdentifiers = [...modelIds, ...featurePatterns]

    const { data: pricingRows, error } = await supabase
      .from("model_pricing")
      .select("model_identifier, credit_cost, is_enabled, tier_restriction, category")
      .in("model_identifier", allIdentifiers)

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const pricingMap = new Map(
      (pricingRows ?? []).map((r) => [r.model_identifier, r])
    )

    // Build per-feature credit cost map — one entry per credit rung
    // (economy / standard / premium / premium-direct), from the shared list.
    const featureCosts: Record<string, Record<LlmCreditRung, number | null>> = {}
    for (const feature of LLM_CREDIT_FEATURES) {
      featureCosts[feature] = Object.fromEntries(
        LLM_CREDIT_RUNGS.map((rung) => [rung, pricingMap.get(llmCreditIdForRung(feature, rung))?.credit_cost ?? null]),
      ) as Record<LlmCreditRung, number | null>
    }

    // Average credit cost per rung
    const tierCosts = Object.fromEntries(LLM_CREDIT_RUNGS.map((rung) => [rung, null])) as Record<LlmCreditRung, number | null>
    for (const tier of LLM_CREDIT_RUNGS) {
      const values = Object.values(featureCosts)
        .map((fc) => fc[tier])
        .filter((v): v is number => v !== null)
      if (values.length > 0) {
        tierCosts[tier] = Math.round(values.reduce((a, b) => a + b, 0) / values.length)
      }
    }

    // Models array (without duplicated featureCosts/tierCosts)
    const models = LLM_MODELS.map((m) => {
      const dbRow = pricingMap.get(m.id)
      return {
        id: m.id,
        displayName: m.displayName,
        tier: m.tier,
        vendor: m.vendor,
        isEnabled: dbRow?.is_enabled ?? true,
      }
    })

    return { data: { models, tierCosts, featureCosts } }
  })

  // PATCH /v1/admin/llm-models/:modelId — toggle enabled/disabled
  app.patch("/v1/admin/llm-models/:modelId", { preHandler: requirePlatformOperator }, async (req, reply) => {
    const { modelId } = req.params as { modelId: string }

    const bodyResult = toggleBody.safeParse(req.body)
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: bodyResult.error.issues[0]?.message ?? "Invalid body",
        },
      })
    }

    const model = LLM_MODELS.find((m) => m.id === modelId)
    if (!model) {
      return reply.status(404).send({
        error: { code: "not_found", message: `LLM model '${modelId}' not found` },
      })
    }

    const { isEnabled } = bodyResult.data

    const { data, error } = await supabase
      .from("model_pricing")
      .upsert(
        {
          model_identifier: modelId,
          credit_cost: 0,
          is_enabled: isEnabled,
          category: "llm",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "model_identifier" }
      )
      .select("model_identifier, is_enabled")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { data }
  })
}
