import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { SYSTEM_PROMPT_TEMPLATES } from "../config/prompt-templates.js"
import { invalidateUserPreferences } from "../lib/mcp/user-preferences.js"
import { formatZodError } from "../lib/zod-error.js"

const PRIVATE_MODE_TIERS = new Set(["standard", "pro", "business"])

/**
 * Drop keys whose value is `null` or `undefined`. Used by the
 * `mcpPreferences` deep-merge so callers can clear individual axes by
 * sending `{ image: { model: null } }`.
 */
function pruneNulls<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined) out[k] = v
  }
  return out as T
}

const SUPPORTED_LOCALES = [
  "en",
  "es",
  "fr",
  "de",
  "pt-BR",
  "ru",
  "hi",
  "ja",
  "ko",
  "zh-CN",
  "he",
  "ar",
] as const

/**
 * Per-user MCP defaults schema. Sparse — every field is optional, missing
 * keys preserve existing values via deep-merge in the PATCH handler.
 *
 * Validation here is intentionally loose: we don't enum-check model ids
 * because the catalog (and thus the valid set) evolves frequently, and the
 * MCP tool's own Zod gate catches stale picks at call time. We only enforce
 * type-shape so the JSONB payload stays sane.
 */
const McpPreferencesPatch = z
  .object({
    image: z
      .object({
        model: z.string().max(64).optional(),
        aspectRatio: z.string().max(16).optional(),
        resolution: z.string().max(8).optional(),
        quality: z.string().max(16).optional(),
      })
      .partial()
      .optional(),
    video: z
      .object({
        model: z.string().max(64).optional(),
        aspectRatio: z.string().max(16).optional(),
        duration: z.number().int().min(1).max(60).optional(),
        resolution: z.string().max(8).optional(),
      })
      .partial()
      .optional(),
    audio: z
      .object({
        ttsModel: z.string().max(64).optional(),
        musicModel: z.string().max(64).optional(),
      })
      .partial()
      .optional(),
  })
  .partial()

export type McpPreferences = z.infer<typeof McpPreferencesPatch>

const updateSettingsBody = z.object({
  publicOutputs: z.boolean().optional(),
  promptTemplates: z.record(z.string(), z.string()).optional(),
  textTemplates: z.array(z.object({
    id: z.string(),
    label: z.string().max(80),
    systemPrompt: z.string().max(10000),
    defaultInput: z.string().max(10000).optional(),
    defaultMaxTokens: z.number().int().min(1).max(16384).optional(),
    llmModel: z.string().optional(),
    fansOut: z.boolean().optional(),
    requiresImageRef: z.boolean().optional(),
  })).max(100).optional(),
  preferredLocale: z.enum(SUPPORTED_LOCALES).nullable().optional(),
  mcpPreferences: McpPreferencesPatch.optional(),
  showRecentNodes: z.boolean().optional(),
  showMostUsedNodes: z.boolean().optional(),
})

/** Generate Text user-defined template preset (stored on profiles.text_templates). */
export type TextTemplate = NonNullable<z.infer<typeof updateSettingsBody>["textTemplates"]>[number]

export async function userSettingsRoutes(app: FastifyInstance) {
  /**
   * GET /v1/user/settings - Fetch user settings (public_outputs, tier)
   */
  app.get("/v1/user/settings", async (req, reply) => {
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({ error: "Authentication required" })
    }

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("tier, public_outputs, prompt_templates, text_templates, preferred_locale, mcp_preferences, show_recent_nodes, show_most_used_nodes")
      .eq("id", userId)
      .single()

    if (error || !profile) {
      return reply.status(404).send({ error: "Profile not found" })
    }

    return reply.send({
      data: {
        tier: profile.tier,
        publicOutputs: profile.public_outputs ?? true,
        promptTemplates: (profile.prompt_templates as Record<string, string>) ?? {},
        textTemplates: (profile.text_templates as TextTemplate[]) ?? [],
        preferredLocale: profile.preferred_locale ?? null,
        mcpPreferences: (profile.mcp_preferences as McpPreferences) ?? {},
        showRecentNodes: profile.show_recent_nodes ?? false,
        showMostUsedNodes: profile.show_most_used_nodes ?? false,
      },
    })
  })

  /**
   * PATCH /v1/user/settings - Update user settings
   *
   * Body: { userId: string, publicOutputs?: boolean, promptTemplates?: Record<string, string> }
   *
   * Tier restriction: only Standard and above can set publicOutputs = false
   */
  app.patch("/v1/user/settings", async (req, reply) => {
    const parsed = updateSettingsBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const userId = req.userId
    const { publicOutputs, promptTemplates, textTemplates, preferredLocale, mcpPreferences, showRecentNodes, showMostUsedNodes } = parsed.data

    if (!userId) {
      return reply.status(401).send({ error: "Authentication required" })
    }

    // Fetch current profile (include public_outputs for response accuracy)
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("tier, public_outputs, prompt_templates, text_templates, preferred_locale, mcp_preferences, show_recent_nodes, show_most_used_nodes")
      .eq("id", userId)
      .single()

    if (profileError || !profile) {
      return reply.status(404).send({ error: "Profile not found" })
    }

    // Only Standard+ tiers can disable public outputs
    if (publicOutputs === false && !PRIVATE_MODE_TIERS.has(profile.tier ?? "free")) {
      return reply.status(403).send({
        error: "Private mode is available on Standard plan and above",
      })
    }

    // Build update object
    const updates: Record<string, unknown> = {}
    if (publicOutputs !== undefined) {
      updates.public_outputs = publicOutputs
    }

    if (showRecentNodes !== undefined) {
      updates.show_recent_nodes = showRecentNodes
    }
    if (showMostUsedNodes !== undefined) {
      updates.show_most_used_nodes = showMostUsedNodes
    }

    // Validate and filter prompt templates
    if (promptTemplates !== undefined) {
      const validKeys = new Set(Object.keys(SYSTEM_PROMPT_TEMPLATES))
      const filtered: Record<string, string> = {}

      for (const [key, value] of Object.entries(promptTemplates)) {
        if (!validKeys.has(key)) continue
        if (typeof value !== "string") continue
        const trimmed = value.trim()
        // Skip empty values or values identical to system default
        if (trimmed === "" || trimmed === SYSTEM_PROMPT_TEMPLATES[key]) continue
        filtered[key] = trimmed
      }

      updates.prompt_templates = filtered
    }

    // Generate Text user-defined templates: a distinct preset LIST (not the
    // Record<string,string> shape of promptTemplates). No system-default
    // catalog to filter against, so persist the validated array verbatim.
    // Ungated — available to all editions, exactly like promptTemplates.
    if (textTemplates !== undefined) {
      updates.text_templates = textTemplates
    }

    // preferred_locale: null clears the preference (re-defaults to browser
    // detection on the frontend); a valid string sets it. Zod enum already
    // validated allowed values.
    if (preferredLocale !== undefined) {
      updates.preferred_locale = preferredLocale
    }

    // mcpPreferences: deep-merge so users can update one axis at a time
    // (e.g. only `image.model` without losing their `image.aspectRatio`).
    // To CLEAR a key, send `null` for it; the merger drops null/undefined
    // values from the saved object so the catalog default takes over again.
    if (mcpPreferences !== undefined) {
      const current = (profile.mcp_preferences as McpPreferences) ?? {}
      const merged: McpPreferences = {
        ...current,
        ...(mcpPreferences.image
          ? { image: pruneNulls({ ...(current.image ?? {}), ...mcpPreferences.image }) }
          : {}),
        ...(mcpPreferences.video
          ? { video: pruneNulls({ ...(current.video ?? {}), ...mcpPreferences.video }) }
          : {}),
        ...(mcpPreferences.audio
          ? { audio: pruneNulls({ ...(current.audio ?? {}), ...mcpPreferences.audio }) }
          : {}),
      }
      updates.mcp_preferences = merged
    }

    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ error: "No valid fields to update" })
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", userId)

    if (updateError) {
      console.error("[user-settings] Update failed:", updateError)
      return reply.status(500).send({ error: "Failed to update settings" })
    }

    // Drop the MCP-side preference cache so the next tool call reads fresh.
    if (mcpPreferences !== undefined) invalidateUserPreferences(userId)

    // Gallery visibility setting only affects NEW jobs — existing items keep their current visibility
    const confirmedPublicOutputs = publicOutputs ?? (profile.public_outputs ?? true)

    const confirmedPreferredLocale =
      preferredLocale !== undefined ? preferredLocale : (profile.preferred_locale ?? null)

    const confirmedMcpPreferences: McpPreferences =
      (updates.mcp_preferences as McpPreferences) ??
      (profile.mcp_preferences as McpPreferences) ??
      {}

    return reply.send({
      data: {
        publicOutputs: confirmedPublicOutputs,
        promptTemplates: (updates.prompt_templates as Record<string, string>) ?? (profile.prompt_templates as Record<string, string>) ?? {},
        textTemplates: (updates.text_templates as TextTemplate[]) ?? (profile.text_templates as TextTemplate[]) ?? [],
        preferredLocale: confirmedPreferredLocale,
        mcpPreferences: confirmedMcpPreferences,
        showRecentNodes: showRecentNodes ?? (profile.show_recent_nodes ?? false),
        showMostUsedNodes: showMostUsedNodes ?? (profile.show_most_used_nodes ?? false),
      },
    })
  })
}
