/**
 * /v1/moodboards — the caller's own moodboards (migration 522).
 *
 * A moodboard is a name, an optional description (the words that go into the
 * prompt) and 1..12 images `{ url, caption? }`. On generate-image it is a
 * direction value — `direction.style: "moodboard:<id>"` — resolved on every
 * run: its description becomes a look clause and its images go along as style
 * references, after the caller's own (`lib/user-direction.ts`).
 *
 * An image is a LINK, never a copy: its url passes the same SSRF gate as every
 * reference image the API takes (`safeUrlSchema`) and is stored as given, so it
 * lives as long as what it points at.
 *
 * Owner-only: every query carries `.eq("user_id", userId)` and a miss is 404.
 * Reads need `assets:read`, writes `assets:write` for an OAuth app.
 * Table-tolerant like `/v1/palettes`.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { isMissingTableError } from "../lib/postgrest-errors.js"
import { decodeKeysetCursor, keysetFilter, sliceKeysetPage } from "../lib/keyset-cursor.js"
import {
  LIST_PAGE_DEFAULT,
  MOODBOARD_COLUMNS,
  createMoodboardBody,
  idParams,
  listQuery,
  normalizeDescription,
  normalizeImages,
  toMoodboard,
  updateMoodboardBody,
  type MoodboardRow,
} from "../lib/palettes-moodboards.js"
// OpenAPI entries (module side effect, like every route file's registerPath).
import "./palettes-moodboards-docs.js"

const WRITE_LIMIT = { rateLimit: { max: 30, timeWindow: "1 minute" } }

function caller(req: FastifyRequest, reply: FastifyReply): string | null {
  if (!req.userId) {
    void reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    return null
  }
  return req.userId
}

function badRequest(reply: FastifyReply, error: z.ZodError) {
  return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(error) } })
}

function notFound(reply: FastifyReply) {
  return reply.status(404).send({ error: { code: "not_found", message: "Moodboard not found" } })
}

function notAvailable(reply: FastifyReply) {
  return reply.status(503).send({ error: { code: "not_available", message: "Moodboards are not available on this server yet." } })
}

export async function moodboardRoutes(app: FastifyInstance) {
  app.get("/v1/moodboards", { preHandler: requireAppScope("assets:read") }, async (req, reply) => {
    const userId = caller(req, reply)
    if (!userId) return
    const parsed = listQuery.safeParse(req.query)
    if (!parsed.success) return badRequest(reply, parsed.error)
    const limit = parsed.data.limit ?? LIST_PAGE_DEFAULT
    const cursor = parsed.data.cursor ? decodeKeysetCursor(parsed.data.cursor) : null
    if (parsed.data.cursor && !cursor) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid cursor" } })
    }

    let query = supabase.from("moodboards").select(MOODBOARD_COLUMNS).eq("user_id", userId)
    if (cursor) query = query.or(keysetFilter(cursor))
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1)
    if (isMissingTableError(error)) return { data: [], nextCursor: null }
    if (error) return sendInternalError(reply, req, error, "Failed to list moodboards")
    const { page, nextCursor } = sliceKeysetPage((data ?? []) as MoodboardRow[], limit)
    return { data: page.map(toMoodboard), nextCursor }
  })

  app.post("/v1/moodboards", { preHandler: requireAppScope("assets:write"), config: WRITE_LIMIT }, async (req, reply) => {
    const userId = caller(req, reply)
    if (!userId) return
    const parsed = createMoodboardBody.safeParse(req.body)
    if (!parsed.success) return badRequest(reply, parsed.error)

    const { data, error } = await supabase
      .from("moodboards")
      .insert({
        user_id: userId,
        name: parsed.data.name,
        description: normalizeDescription(parsed.data.description),
        images: normalizeImages(parsed.data.images),
      })
      .select(MOODBOARD_COLUMNS)
      .single()
    if (isMissingTableError(error)) return notAvailable(reply)
    if (error) return sendInternalError(reply, req, error, "Failed to create moodboard")
    return reply.status(201).send(toMoodboard(data as MoodboardRow))
  })

  app.get("/v1/moodboards/:id", { preHandler: requireAppScope("assets:read") }, async (req, reply) => {
    const userId = caller(req, reply)
    if (!userId) return
    const params = idParams.safeParse(req.params)
    if (!params.success) return badRequest(reply, params.error)

    const { data, error } = await supabase
      .from("moodboards")
      .select(MOODBOARD_COLUMNS)
      .eq("id", params.data.id)
      .eq("user_id", userId)
      .maybeSingle()
    if (isMissingTableError(error)) return notFound(reply)
    if (error) return sendInternalError(reply, req, error, "Failed to fetch moodboard")
    if (!data) return notFound(reply)
    return toMoodboard(data as MoodboardRow)
  })

  app.patch("/v1/moodboards/:id", { preHandler: requireAppScope("assets:write"), config: WRITE_LIMIT }, async (req, reply) => {
    const userId = caller(req, reply)
    if (!userId) return
    const params = idParams.safeParse(req.params)
    if (!params.success) return badRequest(reply, params.error)
    const body = updateMoodboardBody.safeParse(req.body)
    if (!body.success) return badRequest(reply, body.error)

    const { name, description, images } = body.data
    const { data, error } = await supabase
      .from("moodboards")
      .update({
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description: normalizeDescription(description) } : {}),
        ...(images !== undefined ? { images: normalizeImages(images) } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.data.id)
      .eq("user_id", userId)
      .select(MOODBOARD_COLUMNS)
      .maybeSingle()
    if (isMissingTableError(error)) return notAvailable(reply)
    if (error) return sendInternalError(reply, req, error, "Failed to update moodboard")
    if (!data) return notFound(reply)
    return toMoodboard(data as MoodboardRow)
  })

  // Deletes the row only — the images are links to files this route never
  // owned, so nothing in storage is touched. A run that names the moodboard
  // later answers 404 `direction_not_found`.
  app.delete("/v1/moodboards/:id", { preHandler: requireAppScope("assets:write"), config: WRITE_LIMIT }, async (req, reply) => {
    const userId = caller(req, reply)
    if (!userId) return
    const params = idParams.safeParse(req.params)
    if (!params.success) return badRequest(reply, params.error)

    const { data, error } = await supabase
      .from("moodboards")
      .delete()
      .eq("id", params.data.id)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle()
    if (isMissingTableError(error)) return notAvailable(reply)
    if (error) return sendInternalError(reply, req, error, "Failed to delete moodboard")
    if (!data) return notFound(reply)
    return { success: true }
  })
}
