import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"

// ============================================================
// Admin Routes - Cost Alerts & Model Pricing Management
// ============================================================

// ---- Zod Schemas ----

const createAlertBody = z.object({
  alertType: z.enum(["cost_overrun", "credit_low", "usage_spike"]),
  threshold: z.number().min(0),
  userId: z.string().uuid().optional(),
  isEnabled: z.boolean().optional().default(true),
})

const updateAlertBody = z.object({
  alertType: z.enum(["cost_overrun", "credit_low", "usage_spike"]).optional(),
  threshold: z.number().min(0).optional(),
  isEnabled: z.boolean().optional(),
})

const alertIdParams = z.object({
  id: z.string().uuid(),
})

const upsertModelPricingBody = z.object({
  modelIdentifier: z.string().min(1),
  displayName: z.string().min(1),
  category: z.enum(["image", "video", "tts", "music", "audio", "processing", "script"]),
  creditCost: z.number().min(0),
  isEnabled: z.boolean().optional().default(true),
  tierRestriction: z.string().optional().default("free"),
})

const modelIdParams = z.object({
  id: z.string().uuid(),
})

const toggleModelBody = z.object({
  isEnabled: z.boolean(),
})

export async function adminRoutes(app: FastifyInstance) {
  // ============================================================
  // Cost Alerts Endpoints
  // ============================================================

  /**
   * GET /v1/admin/alerts
   * List all cost alerts
   */
  app.get("/v1/admin/alerts", async (_req, reply) => {
    const { data, error } = await supabase
      .from("admin_alerts")
      .select("*")
      .order("created_at", { ascending: false })

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { data: data ?? [] }
  })

  /**
   * POST /v1/admin/alerts
   * Create a new cost alert
   */
  app.post("/v1/admin/alerts", async (req, reply) => {
    const parsed = createAlertBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { alertType, threshold, userId, isEnabled } = parsed.data

    const { data, error } = await supabase
      .from("admin_alerts")
      .insert({
        alert_type: alertType,
        threshold,
        user_id: userId ?? null,
        is_enabled: isEnabled,
      })
      .select()
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { data }
  })

  /**
   * PUT /v1/admin/alerts/:id
   * Update an existing cost alert
   */
  app.put<{
    Params: { id: string }
  }>("/v1/admin/alerts/:id", async (req, reply) => {
    const paramsResult = alertIdParams.safeParse(req.params)
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: paramsResult.error.issues[0]?.message ?? "Invalid ID",
        },
      })
    }

    const bodyResult = updateAlertBody.safeParse(req.body)
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: bodyResult.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { id } = paramsResult.data
    const updates: Record<string, unknown> = {}

    if (bodyResult.data.alertType !== undefined) {
      updates.alert_type = bodyResult.data.alertType
    }
    if (bodyResult.data.threshold !== undefined) {
      updates.threshold = bodyResult.data.threshold
    }
    if (bodyResult.data.isEnabled !== undefined) {
      updates.is_enabled = bodyResult.data.isEnabled
    }

    const { data, error } = await supabase
      .from("admin_alerts")
      .update(updates)
      .eq("id", id)
      .select()
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        return reply.status(404).send({
          error: { code: "not_found", message: "Alert not found" },
        })
      }
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { data }
  })

  /**
   * DELETE /v1/admin/alerts/:id
   * Delete a cost alert
   */
  app.delete<{
    Params: { id: string }
  }>("/v1/admin/alerts/:id", async (req, reply) => {
    const paramsResult = alertIdParams.safeParse(req.params)
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: paramsResult.error.issues[0]?.message ?? "Invalid ID",
        },
      })
    }

    const { id } = paramsResult.data

    const { error } = await supabase
      .from("admin_alerts")
      .delete()
      .eq("id", id)

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { success: true }
  })

  // ============================================================
  // Model Pricing Endpoints
  // ============================================================

  /**
   * GET /v1/admin/model-pricing
   * List all model pricing entries
   */
  app.get("/v1/admin/model-pricing", async (_req, reply) => {
    const { data, error } = await supabase
      .from("model_pricing")
      .select("*")
      .order("category", { ascending: true })

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { data: data ?? [] }
  })

  /**
   * POST /v1/admin/model-pricing
   * Create or update model pricing (upsert on model_identifier)
   */
  app.post("/v1/admin/model-pricing", async (req, reply) => {
    const parsed = upsertModelPricingBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { modelIdentifier, displayName, category, creditCost, isEnabled, tierRestriction } = parsed.data

    const { data, error } = await supabase
      .from("model_pricing")
      .upsert(
        {
          model_identifier: modelIdentifier,
          display_name: displayName,
          category,
          credit_cost: creditCost,
          is_enabled: isEnabled,
          tier_restriction: tierRestriction,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "model_identifier" }
      )
      .select()
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { data }
  })

  /**
   * PUT /v1/admin/model-pricing/:id/toggle
   * Enable or disable a model
   */
  app.put<{
    Params: { id: string }
  }>("/v1/admin/model-pricing/:id/toggle", async (req, reply) => {
    const paramsResult = modelIdParams.safeParse(req.params)
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: paramsResult.error.issues[0]?.message ?? "Invalid ID",
        },
      })
    }

    const bodyResult = toggleModelBody.safeParse(req.body)
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: bodyResult.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { id } = paramsResult.data
    const { isEnabled } = bodyResult.data

    const { data, error } = await supabase
      .from("model_pricing")
      .update({ is_enabled: isEnabled, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        return reply.status(404).send({
          error: { code: "not_found", message: "Model pricing entry not found" },
        })
      }
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { data }
  })

  /**
   * DELETE /v1/admin/model-pricing/:id
   * Delete a model pricing entry
   */
  app.delete<{
    Params: { id: string }
  }>("/v1/admin/model-pricing/:id", async (req, reply) => {
    const paramsResult = modelIdParams.safeParse(req.params)
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: paramsResult.error.issues[0]?.message ?? "Invalid ID",
        },
      })
    }

    const { id } = paramsResult.data

    const { error } = await supabase
      .from("model_pricing")
      .delete()
      .eq("id", id)

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { success: true }
  })
}
