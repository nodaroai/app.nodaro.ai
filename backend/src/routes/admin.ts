import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { checkIsAdmin } from "../lib/admin-check.js"

// ============================================================
// Admin Routes - Cost Alerts, Model Pricing & Asset Library
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

const assetIdParams = z.object({
  id: z.string().uuid(),
})

const assetActionBody = z.object({
  userId: z.string().uuid(),
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

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "userId is required" },
      })
    }

    const { data, error } = await supabase
      .from("admin_alerts")
      .insert({
        alert_type: alertType,
        threshold,
        user_id: userId,
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

  // ============================================================
  // Asset Library Endpoints
  // ============================================================

  /**
   * POST /v1/admin/assets/:id/promote-to-library
   * Promote an asset to the shared library (admin only)
   */
  app.post<{
    Params: { id: string }
  }>("/v1/admin/assets/:id/promote-to-library", async (req, reply) => {
    const paramsResult = assetIdParams.safeParse(req.params)
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: paramsResult.error.issues[0]?.message ?? "Invalid asset ID",
        },
      })
    }

    const bodyResult = assetActionBody.safeParse(req.body)
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: bodyResult.error.issues[0]?.message ?? "userId is required",
        },
      })
    }

    const { id: assetId } = paramsResult.data
    const { userId } = bodyResult.data

    // Check admin permission
    const isAdmin = await checkIsAdmin(userId)
    if (!isAdmin) {
      return reply.status(403).send({
        error: { code: "forbidden", message: "Only admins can promote assets to library" },
      })
    }

    // Fetch the asset to merge metadata
    const { data: existing, error: fetchError } = await supabase
      .from("assets")
      .select("*")
      .eq("id", assetId)
      .single()

    if (fetchError) {
      if (fetchError.code === "PGRST116") {
        return reply.status(404).send({
          error: { code: "not_found", message: "Asset not found" },
        })
      }
      return reply.status(500).send({
        error: { code: "internal_error", message: fetchError.message },
      })
    }

    // Merge promotion info, removing stale demote metadata from previous cycle
    const existingMetadata = (existing.metadata as Record<string, unknown>) ?? {}
    const { demoted_at: _da, demoted_by: _db, ...cleanMetadata } = existingMetadata
    const updatedMetadata = {
      ...cleanMetadata,
      promoted_at: new Date().toISOString(),
      promoted_by: userId,
    }

    const { data: asset, error: updateError } = await supabase
      .from("assets")
      .update({
        is_library_item: true,
        upload_source: "library",
        metadata: updatedMetadata,
      })
      .eq("id", assetId)
      .select()
      .single()

    if (updateError) {
      return reply.status(500).send({
        error: { code: "internal_error", message: updateError.message },
      })
    }

    return {
      success: true,
      message: "Asset promoted to library",
      data: asset,
    }
  })

  /**
   * POST /v1/admin/assets/:id/demote-from-library
   * Remove an asset from the shared library (admin only)
   */
  app.post<{
    Params: { id: string }
  }>("/v1/admin/assets/:id/demote-from-library", async (req, reply) => {
    const paramsResult = assetIdParams.safeParse(req.params)
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: paramsResult.error.issues[0]?.message ?? "Invalid asset ID",
        },
      })
    }

    const bodyResult = assetActionBody.safeParse(req.body)
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: bodyResult.error.issues[0]?.message ?? "userId is required",
        },
      })
    }

    const { id: assetId } = paramsResult.data
    const { userId } = bodyResult.data

    // Check admin permission
    const isAdmin = await checkIsAdmin(userId)
    if (!isAdmin) {
      return reply.status(403).send({
        error: { code: "forbidden", message: "Only admins can demote assets from library" },
      })
    }

    // Fetch the asset to merge metadata
    const { data: existing, error: fetchError } = await supabase
      .from("assets")
      .select("*")
      .eq("id", assetId)
      .single()

    if (fetchError) {
      if (fetchError.code === "PGRST116") {
        return reply.status(404).send({
          error: { code: "not_found", message: "Asset not found" },
        })
      }
      return reply.status(500).send({
        error: { code: "internal_error", message: fetchError.message },
      })
    }

    // Remove promotion metadata
    const existingMetadata = (existing.metadata as Record<string, unknown>) ?? {}
    const { promoted_at, promoted_by, ...restMetadata } = existingMetadata
    const updatedMetadata = {
      ...restMetadata,
      demoted_at: new Date().toISOString(),
      demoted_by: userId,
    }

    const { data: asset, error: updateError } = await supabase
      .from("assets")
      .update({
        is_library_item: false,
        upload_source: "manual_upload",
        metadata: updatedMetadata,
      })
      .eq("id", assetId)
      .select()
      .single()

    if (updateError) {
      return reply.status(500).send({
        error: { code: "internal_error", message: updateError.message },
      })
    }

    return {
      success: true,
      message: "Asset demoted from library",
      data: asset,
    }
  })
}
