import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { invalidateSettingsCache } from "../lib/app-settings.js"
import { requireAdmin } from "../middleware/require-admin.js"

const updateSettingBody = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.unknown()), z.record(z.unknown())]),
})

const settingKeyParams = z.object({
  key: z.string().min(1),
})

export async function adminSettingsRoutes(app: FastifyInstance) {
  // Get all settings
  app.get("/v1/admin/settings", { preHandler: requireAdmin }, async (req, reply) => {
    const { data, error } = await supabase
      .from("app_settings")
      .select("key, value, updated_at")
      .order("key")

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    // Transform to key-value object
    const settings: Record<string, unknown> = {}
    for (const row of data ?? []) {
      settings[row.key] = row.value
    }

    return { settings }
  })

  // Get single setting by key
  app.get("/v1/admin/settings/:key", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = settingKeyParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid key",
        },
      })
    }

    const { key } = parsed.data

    const { data, error } = await supabase
      .from("app_settings")
      .select("key, value, updated_at")
      .eq("key", key)
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        return reply.status(404).send({
          error: { code: "not_found", message: `Setting '${key}' not found` },
        })
      }
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return {
      key: data.key,
      value: data.value,
      updatedAt: data.updated_at,
    }
  })

  // Update setting (upsert)
  app.put("/v1/admin/settings/:key", { preHandler: requireAdmin }, async (req, reply) => {
    const paramsResult = settingKeyParams.safeParse(req.params)
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: paramsResult.error.issues[0]?.message ?? "Invalid key",
        },
      })
    }

    const bodyResult = updateSettingBody.safeParse(req.body)
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: bodyResult.error.issues[0]?.message ?? "Invalid value",
        },
      })
    }

    const { key } = paramsResult.data
    const { value } = bodyResult.data

    // Validate specific settings
    if (key === "ai_provider") {
      if (typeof value !== "string" || value !== "kie") {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: "ai_provider must be 'kie'",
          },
        })
      }
    }

    if (key === "cost_markup_percent") {
      if (typeof value !== "number" || value < 0 || value > 500) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: "cost_markup_percent must be a number between 0 and 500",
          },
        })
      }
    }

    if (key === "apps_video_autoplay") {
      if (typeof value !== "boolean") {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: "apps_video_autoplay must be a boolean",
          },
        })
      }
    }

    if (key === "featured_app_ids") {
      if (!Array.isArray(value) || !value.every((v: unknown) => typeof v === "string")) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: "featured_app_ids must be an array of strings",
          },
        })
      }
    }

    if (key === "featured_apps_limit") {
      if (typeof value !== "number" || value < 1 || value > 50) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: "featured_apps_limit must be a number between 1 and 50",
          },
        })
      }
    }

    const { data, error } = await supabase
      .from("app_settings")
      .upsert(
        {
          key,
          value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" }
      )
      .select("key, value, updated_at")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    // Invalidate cached settings so changes take effect immediately
    invalidateSettingsCache()

    return {
      key: data.key,
      value: data.value,
      updatedAt: data.updated_at,
    }
  })
}
