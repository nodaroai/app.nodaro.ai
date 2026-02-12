import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase.js"
import { SYSTEM_PROMPT_TEMPLATES } from "../config/prompt-templates.js"

const PRIVATE_MODE_TIERS = new Set(["standard", "pro", "business"])

export async function userSettingsRoutes(app: FastifyInstance) {
  /**
   * GET /v1/user/settings - Fetch user settings (public_outputs, tier)
   */
  app.get("/v1/user/settings", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>
    const userId = query.userId

    if (!userId) {
      return reply.status(400).send({ error: "userId is required" })
    }

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("tier, public_outputs, prompt_templates")
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
    const body = req.body as Record<string, unknown> | undefined
    const userId = body?.userId as string | undefined
    const publicOutputs = body?.publicOutputs as boolean | undefined
    const promptTemplates = body?.promptTemplates as Record<string, string> | undefined

    if (!userId) {
      return reply.status(400).send({ error: "userId is required" })
    }

    // Fetch current profile (include public_outputs for response accuracy)
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("tier, public_outputs, prompt_templates")
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

    // When gallery visibility changes, sync existing jobs to match
    if (publicOutputs !== undefined && publicOutputs !== (profile.public_outputs ?? true)) {
      const { error: jobsError } = await supabase
        .from("jobs")
        .update({ is_public: publicOutputs })
        .eq("user_id", userId)

      if (jobsError) {
        console.error("[user-settings] Failed to sync jobs visibility:", jobsError)
      }
    }

    const confirmedPublicOutputs = publicOutputs ?? (profile.public_outputs ?? true)

    return reply.send({
      data: {
        publicOutputs: confirmedPublicOutputs,
        promptTemplates: (updates.prompt_templates as Record<string, string>) ?? (profile.prompt_templates as Record<string, string>) ?? {},
      },
    })
  })
}
