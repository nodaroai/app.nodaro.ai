/**
 * /v1/palettes — the caller's own colour palettes (migration 522).
 *
 * A palette is a name, 2..12 `#RRGGBB` colours (stored upper case) and an
 * optional note. On generate-image it is a direction value —
 * `direction.colorLook: "palette:<id>"` — resolved on every run into a clause
 * naming each colour (`lib/user-direction.ts`).
 *
 * Owner-only: every query carries `.eq("user_id", userId)` and a miss is 404,
 * never 403, so an id is no oracle. Reads need `assets:read`, writes
 * `assets:write` for an OAuth app; first-party and personal-key callers own
 * their rows. Table-tolerant: the table reaches the shared database when main
 * deploys, so until then the list is empty and a write answers 503.
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
  PALETTE_COLUMNS,
  createPaletteBody,
  idParams,
  listQuery,
  normalizeColors,
  normalizeDescription,
  toPalette,
  updatePaletteBody,
  type PaletteRow,
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
  return reply.status(404).send({ error: { code: "not_found", message: "Palette not found" } })
}

function notAvailable(reply: FastifyReply) {
  return reply.status(503).send({ error: { code: "not_available", message: "Palettes are not available on this server yet." } })
}

export async function paletteRoutes(app: FastifyInstance) {
  app.get("/v1/palettes", { preHandler: requireAppScope("assets:read") }, async (req, reply) => {
    const userId = caller(req, reply)
    if (!userId) return
    const parsed = listQuery.safeParse(req.query)
    if (!parsed.success) return badRequest(reply, parsed.error)
    const limit = parsed.data.limit ?? LIST_PAGE_DEFAULT
    const cursor = parsed.data.cursor ? decodeKeysetCursor(parsed.data.cursor) : null
    if (parsed.data.cursor && !cursor) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid cursor" } })
    }

    let query = supabase.from("color_palettes").select(PALETTE_COLUMNS).eq("user_id", userId)
    if (cursor) query = query.or(keysetFilter(cursor))
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1)
    if (isMissingTableError(error)) return { data: [], nextCursor: null }
    if (error) return sendInternalError(reply, req, error, "Failed to list palettes")
    const { page, nextCursor } = sliceKeysetPage((data ?? []) as PaletteRow[], limit)
    return { data: page.map(toPalette), nextCursor }
  })

  app.post("/v1/palettes", { preHandler: requireAppScope("assets:write"), config: WRITE_LIMIT }, async (req, reply) => {
    const userId = caller(req, reply)
    if (!userId) return
    const parsed = createPaletteBody.safeParse(req.body)
    if (!parsed.success) return badRequest(reply, parsed.error)

    const { data, error } = await supabase
      .from("color_palettes")
      .insert({
        user_id: userId,
        name: parsed.data.name,
        colors: normalizeColors(parsed.data.colors),
        description: normalizeDescription(parsed.data.description),
      })
      .select(PALETTE_COLUMNS)
      .single()
    if (isMissingTableError(error)) return notAvailable(reply)
    if (error) return sendInternalError(reply, req, error, "Failed to create palette")
    return reply.status(201).send(toPalette(data as PaletteRow))
  })

  app.get("/v1/palettes/:id", { preHandler: requireAppScope("assets:read") }, async (req, reply) => {
    const userId = caller(req, reply)
    if (!userId) return
    const params = idParams.safeParse(req.params)
    if (!params.success) return badRequest(reply, params.error)

    const { data, error } = await supabase
      .from("color_palettes")
      .select(PALETTE_COLUMNS)
      .eq("id", params.data.id)
      .eq("user_id", userId)
      .maybeSingle()
    if (isMissingTableError(error)) return notFound(reply)
    if (error) return sendInternalError(reply, req, error, "Failed to fetch palette")
    if (!data) return notFound(reply)
    return toPalette(data as PaletteRow)
  })

  app.patch("/v1/palettes/:id", { preHandler: requireAppScope("assets:write"), config: WRITE_LIMIT }, async (req, reply) => {
    const userId = caller(req, reply)
    if (!userId) return
    const params = idParams.safeParse(req.params)
    if (!params.success) return badRequest(reply, params.error)
    const body = updatePaletteBody.safeParse(req.body)
    if (!body.success) return badRequest(reply, body.error)

    const { name, colors, description } = body.data
    const { data, error } = await supabase
      .from("color_palettes")
      .update({
        ...(name !== undefined ? { name } : {}),
        ...(colors !== undefined ? { colors: normalizeColors(colors) } : {}),
        ...(description !== undefined ? { description: normalizeDescription(description) } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.data.id)
      .eq("user_id", userId)
      .select(PALETTE_COLUMNS)
      .maybeSingle()
    if (isMissingTableError(error)) return notAvailable(reply)
    if (error) return sendInternalError(reply, req, error, "Failed to update palette")
    if (!data) return notFound(reply)
    return toPalette(data as PaletteRow)
  })

  // A run that names the palette later answers 404 `direction_not_found`: the
  // job keeps the id it was given, never a copy of the colours.
  app.delete("/v1/palettes/:id", { preHandler: requireAppScope("assets:write"), config: WRITE_LIMIT }, async (req, reply) => {
    const userId = caller(req, reply)
    if (!userId) return
    const params = idParams.safeParse(req.params)
    if (!params.success) return badRequest(reply, params.error)

    const { data, error } = await supabase
      .from("color_palettes")
      .delete()
      .eq("id", params.data.id)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle()
    if (isMissingTableError(error)) return notAvailable(reply)
    if (error) return sendInternalError(reply, req, error, "Failed to delete palette")
    if (!data) return notFound(reply)
    return { success: true }
  })
}
