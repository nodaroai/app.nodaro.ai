import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase.js"

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
      .select("tier, public_outputs")
      .eq("id", userId)
      .single()

    if (error || !profile) {
      return reply.status(404).send({ error: "Profile not found" })
    }

    return reply.send({
      data: {
        tier: profile.tier,
        publicOutputs: profile.public_outputs ?? true,
      },
    })
  })

  /**
   * PATCH /v1/user/settings - Update user settings
   *
   * Body: { userId: string, publicOutputs?: boolean }
   *
   * Tier restriction: only Standard and above can set publicOutputs = false
   */
  app.patch("/v1/user/settings", async (req, reply) => {
    const body = req.body as Record<string, unknown> | undefined
    const userId = body?.userId as string | undefined
    const publicOutputs = body?.publicOutputs as boolean | undefined

    if (!userId) {
      return reply.status(400).send({ error: "userId is required" })
    }

    // Fetch current tier
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("tier")
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

    return reply.send({ data: { publicOutputs: publicOutputs ?? true } })
  })
}
