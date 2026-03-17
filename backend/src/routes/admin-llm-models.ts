import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { LLM_MODELS, LLM_FEATURE_DEFAULTS } from "../../../packages/shared/src/llm-models.js"
import type { LlmFeature } from "../../../packages/shared/src/llm-models.js"

/** Derive credit features from the shared LlmFeature type (single source of truth) */
const LLM_CREDIT_FEATURES = Object.keys(LLM_FEATURE_DEFAULTS) as LlmFeature[]

const toggleBody = z.object({
  isEnabled: z.boolean(),
})

export async function adminLlmModelsRoutes(app: FastifyInstance) {
  // GET /v1/admin/llm-models — list all LLM models merged with DB pricing
  app.get("/v1/admin/llm-models", { preHandler: requireAdmin }, async (_req, reply) => {
    const modelIds = LLM_MODELS.map((m) => m.id)
    const featurePatterns = LLM_CREDIT_FEATURES.flatMap((f) => [
      f,
      `${f}:economy`,
      `${f}:premium`,
    ])
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

    // Build per-feature credit cost map
    const featureCosts: Record<string, { economy: number | null; standard: number | null; premium: number | null }> = {}
    for (const feature of LLM_CREDIT_FEATURES) {
      const base = pricingMap.get(feature)
      const economy = pricingMap.get(`${feature}:economy`)
      const premium = pricingMap.get(`${feature}:premium`)
      featureCosts[feature] = {
        economy: economy?.credit_cost ?? null,
        standard: base?.credit_cost ?? null,
        premium: premium?.credit_cost ?? null,
      }
    }

    // Average credit cost per tier
    const tierCosts = { economy: null as number | null, standard: null as number | null, premium: null as number | null }
    for (const tier of ["economy", "standard", "premium"] as const) {
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
  app.patch("/v1/admin/llm-models/:modelId", { preHandler: requireAdmin }, async (req, reply) => {
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
