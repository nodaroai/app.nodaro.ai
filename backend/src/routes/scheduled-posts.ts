import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { rejectProgrammaticAuth } from "../lib/api-auth-mode.js"
import { supabase } from "../lib/supabase.js"
import { MEDIA_REQUIRED_ACTIONS, VALID_ACTIONS } from "../services/social/actions.js"
import { MediaRefError, normalizeMediaInput } from "../services/social/media-refs.js"
import { getProvider } from "../services/social/providers/registry.js"

const SOCIAL_NO_OAUTH_MSG = "Social account management is not available to OAuth apps."

const mediaInputSchema = z.object({
  type: z.enum(["photo", "video"]),
  r2Key: z.string().min(1).optional(),
  url: z.string().url().optional(),
})

const payloadFields = {
  caption: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  privacy: z.enum(["private", "unlisted", "public"]).optional(),
  chatId: z.string().optional(),
  parseMode: z.enum(["Markdown", "HTML"]).optional(),
}

const createSchema = z.object({
  connectionId: z.string().uuid(),
  action: z.enum(VALID_ACTIONS),
  scheduledAt: z.string().datetime({ offset: true }),
  media: z.array(mediaInputSchema).max(20).optional(),
  ...payloadFields,
})

const patchSchema = z.object({
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  action: z.enum(VALID_ACTIONS).optional(),
  media: z.array(mediaInputSchema).max(20).optional(),
  ...payloadFields,
})

function buildPayload(data: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const key of ["caption", "title", "description", "tags", "privacy", "chatId", "parseMode"]) {
    if (data[key] !== undefined) payload[key] = data[key]
  }
  return payload
}

const EDITABLE_STATUSES = ["draft", "queued"]

export async function scheduledPostsRoutes(app: FastifyInstance) {
  // POST /v1/social/scheduled-posts — schedule a publish
  app.post("/v1/social/scheduled-posts", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized" } })
    if (rejectProgrammaticAuth(req, reply, SOCIAL_NO_OAUTH_MSG, { allowPersonalToken: true })) return

    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.message } })
    }
    const { connectionId, action, scheduledAt, media } = parsed.data

    if (new Date(scheduledAt).getTime() <= Date.now()) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "scheduledAt must be in the future" },
      })
    }

    // Ownership + platform come from the connection row (never from the client).
    const { data: connRows } = await supabase
      .from("social_connections")
      .select("id, platform")
      .eq("user_id", userId)
      .eq("id", connectionId)
    const connection = connRows?.[0] as { id: string; platform: string } | undefined
    if (!connection || !getProvider(connection.platform)) {
      return reply.status(400).send({
        error: { code: "not_connected", message: "Connection not found." },
      })
    }

    if (MEDIA_REQUIRED_ACTIONS.has(action) && (!media || media.length === 0)) {
      return reply.status(400).send({
        error: { code: "validation_error", message: `Action "${action}" requires media` },
      })
    }

    let mediaRefs
    try {
      mediaRefs = normalizeMediaInput(media ?? [])
    } catch (err) {
      if (err instanceof MediaRefError) {
        return reply.status(400).send({ error: { code: "validation_error", message: err.message } })
      }
      throw err
    }

    const { data: row, error } = await supabase
      .from("scheduled_posts")
      .insert({
        user_id: userId,
        connection_id: connection.id,
        platform: connection.platform,
        action,
        payload: buildPayload(parsed.data),
        media: mediaRefs,
        scheduled_at: scheduledAt,
        status: "queued",
      })
      .select("*")
      .single()

    if (error || !row) {
      return reply.status(500).send({ error: { code: "internal_error" } })
    }
    return reply.status(201).send({ scheduledPost: row })
  })

  // GET /v1/social/scheduled-posts?from=&to=&status=&connectionId=
  app.get("/v1/social/scheduled-posts", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized" } })

    const { from, to, status, connectionId } = req.query as {
      from?: string
      to?: string
      status?: string
      connectionId?: string
    }

    let query = supabase
      .from("scheduled_posts")
      .select("*")
      .eq("user_id", userId)
      .order("scheduled_at", { ascending: true })
      .limit(200)
    if (from) query = query.gte("scheduled_at", from)
    if (to) query = query.lte("scheduled_at", to)
    if (status) query = query.eq("status", status)
    if (connectionId) query = query.eq("connection_id", connectionId)

    const { data, error } = await query
    if (error) return reply.status(500).send({ error: { code: "internal_error" } })
    return { scheduledPosts: data ?? [] }
  })

  // PATCH /v1/social/scheduled-posts/:id — edit while still draft/queued.
  // The status guard doubles as the CAS: a row the worker already claimed
  // (publishing) refuses the edit with a 409.
  app.patch("/v1/social/scheduled-posts/:id", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized" } })
    if (rejectProgrammaticAuth(req, reply, SOCIAL_NO_OAUTH_MSG, { allowPersonalToken: true })) return

    const { id } = req.params as { id: string }
    const parsed = patchSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.message } })
    }

    if (parsed.data.scheduledAt && new Date(parsed.data.scheduledAt).getTime() <= Date.now()) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "scheduledAt must be in the future" },
      })
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (parsed.data.scheduledAt) patch.scheduled_at = parsed.data.scheduledAt
    if (parsed.data.action) patch.action = parsed.data.action
    if (parsed.data.media) {
      try {
        patch.media = normalizeMediaInput(parsed.data.media)
      } catch (err) {
        if (err instanceof MediaRefError) {
          return reply.status(400).send({ error: { code: "validation_error", message: err.message } })
        }
        throw err
      }
    }
    const payloadPatch = buildPayload(parsed.data)
    if (Object.keys(payloadPatch).length > 0) {
      // Merge over the existing payload so a caption-only PATCH keeps tags etc.
      const { data: existing } = await supabase
        .from("scheduled_posts")
        .select("payload")
        .eq("id", id)
        .eq("user_id", userId)
        .single()
      patch.payload = { ...((existing as { payload?: Record<string, unknown> })?.payload ?? {}), ...payloadPatch }
    }

    const { data: updated, error } = await supabase
      .from("scheduled_posts")
      .update(patch)
      .eq("id", id)
      .eq("user_id", userId)
      .in("status", EDITABLE_STATUSES)
      .select("*")

    if (error) return reply.status(500).send({ error: { code: "internal_error" } })
    if (!updated?.length) {
      return reply.status(409).send({
        error: { code: "not_editable", message: "Post not found or already publishing/published." },
      })
    }
    return { scheduledPost: updated[0] }
  })

  // DELETE /v1/social/scheduled-posts/:id — cancel (soft; history retained)
  app.delete("/v1/social/scheduled-posts/:id", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized" } })
    if (rejectProgrammaticAuth(req, reply, SOCIAL_NO_OAUTH_MSG, { allowPersonalToken: true })) return

    const { id } = req.params as { id: string }
    const { data: updated, error } = await supabase
      .from("scheduled_posts")
      .update({ status: "canceled", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId)
      .in("status", EDITABLE_STATUSES)
      .select("id")

    if (error) return reply.status(500).send({ error: { code: "internal_error" } })
    if (!updated?.length) {
      return reply.status(409).send({
        error: { code: "not_cancelable", message: "Post not found or already publishing/published." },
      })
    }
    return { success: true }
  })
}
