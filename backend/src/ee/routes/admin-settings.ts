import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { invalidateSettingsCache } from "../../lib/app-settings.js"
import { invalidateConsentConfigCache } from "../lib/consent-config.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { requirePlatformOperator } from "../middleware/require-platform-operator.js"

const updateSettingBody = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.unknown()), z.record(z.string(), z.unknown())]),
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
  app.put("/v1/admin/settings/:key", { preHandler: requirePlatformOperator }, async (req, reply) => {
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

    if (key === "service_margin_percent") {
      const bad =
        typeof value !== "object" || value === null || Array.isArray(value)
          ? "service_margin_percent must be an object of identifier-prefix -> percent"
          : Object.entries(value).find(
              ([prefix, pct]) =>
                prefix.trim().length === 0 ||
                typeof pct !== "number" ||
                !Number.isFinite(pct) ||
                pct < 0 ||
                pct > 500,
            )
            ? "each service margin needs a non-empty prefix and a percent between 0 and 500"
            : null
      if (bad) {
        return reply.status(400).send({
          error: { code: "validation_error", message: bad },
        })
      }
    }

    if (
      key === "carousel_video_autoplay" ||
      key === "apps_page_video_autoplay" ||
      // The copilot's runtime pause. `copilotEnabled()` in routes/copilot.ts
      // reads this and stops serving turns when it is false; a non-boolean
      // written here would be read tolerantly as "on" and the off switch would
      // silently not work, which is the one thing an emergency stop must not do.
      key === "copilot_enabled"
    ) {
      if (typeof value !== "boolean") {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: `${key} must be a boolean`,
          },
        })
      }
    }

    if (key === "copilot_default_tier") {
      if (value !== "economy" && value !== "standard" && value !== "premium") {
        return reply.status(400).send({
          error: { code: "validation_error", message: "copilot_default_tier must be economy, standard or premium" },
        })
      }
    }

    if (key === "copilot_tier_caps") {
      // Shape only — the runtime resolver (`tier-settings.ts`) is what CLAMPS
      // every number and DERIVES the hard timeout, so a value that passes this
      // can still never wedge a turn or invert the stop-timer pair. This guard
      // just refuses a payload that is not a map of tiers to number fields.
      const tiers = ["economy", "standard", "premium"]
      const fields = ["maxIterations", "maxToolCalls", "wallClockMinutes"]
      const ok =
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.entries(value as Record<string, unknown>).every(
          ([tier, caps]) =>
            tiers.includes(tier) &&
            caps !== null &&
            typeof caps === "object" &&
            !Array.isArray(caps) &&
            Object.entries(caps as Record<string, unknown>).every(
              ([f, v]) => fields.includes(f) && typeof v === "number" && Number.isFinite(v),
            ),
        )
      if (!ok) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: "copilot_tier_caps must map economy/standard/premium to { maxIterations, maxToolCalls, wallClockMinutes } numbers",
          },
        })
      }
    }

    if (key === "consent_enabled") {
      if (typeof value !== "boolean") {
        return reply.status(400).send({
          error: { code: "validation_error", message: "consent_enabled must be a boolean" },
        })
      }
    }

    if (key === "consent_login_definition") {
      if (value !== "session" && value !== "app_open") {
        return reply.status(400).send({
          error: { code: "validation_error", message: "consent_login_definition must be 'session' or 'app_open'" },
        })
      }
    }

    if (key === "consent_text") {
      if (typeof value !== "string" || value.trim().length === 0 || value.length > 500) {
        return reply.status(400).send({
          error: { code: "validation_error", message: "consent_text must be a non-empty string up to 500 characters" },
        })
      }
    }

    if (key === "consent_cadence_hours" || key === "consent_withdrawn_cadence_hours") {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 8760) {
        return reply.status(400).send({
          error: { code: "validation_error", message: `${key} must be a number of hours between 0 and 8760` },
        })
      }
    }

    if (key === "consent_max_asks") {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 50) {
        return reply.status(400).send({
          error: { code: "validation_error", message: "consent_max_asks must be an integer between 1 and 50" },
        })
      }
    }

    if (key === "consent_version") {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
        return reply.status(400).send({
          error: { code: "validation_error", message: "consent_version must be an integer >= 1" },
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

    if (key === "apps_auto_scroll_seconds") {
      if (typeof value !== "number" || value < 0 || value > 60) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: "apps_auto_scroll_seconds must be a number between 0 and 60 (0 to disable)",
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
    invalidateConsentConfigCache()

    return {
      key: data.key,
      value: data.value,
      updatedAt: data.updated_at,
    }
  })
}
