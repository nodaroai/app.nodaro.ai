import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { sendInternalError } from "../lib/http-errors.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { VOICE_FAVORITE_TYPES, type VoiceFavorite } from "@nodaro/shared/pipeline"

/**
 * A user's favorite voices (migration 608): a premade voice, a Voice Library
 * voice or one of their own clones, starred from any client and read back by
 * all of them, newest first. The star carries a snapshot (`name`, `previewUrl`)
 * so a favorites list renders with no second lookup; re-starring refreshes it.
 *
 * The table grants nothing to client roles (service-role only, like saved
 * posts), so these routes are the one way in: every handler derives
 * `userId = req.userId` (401 if absent) and every query chains
 * `.eq("user_id", userId)`. Reads: the session, a personal key, or an OAuth app
 * with `assets:read` (like the gallery's favorites). Writes: `assets:write`,
 * like the gallery's star and the preset favorites. Both writes are idempotent.
 */

/** Enough for any real library; a stop against a runaway client, not a product limit. */
export const MAX_VOICE_FAVORITES_PER_USER = 500

/** Writes are rate limited like the preset library's (lib/presets/write-access.ts). */
const WRITE_LIMIT = { rateLimit: { max: 60, timeWindow: "1 minute" } }

const voiceIdParam = z.string().min(1).max(200)

/**
 * A preview is an https URL the clients will load and play — never a `javascript:`
 * or `data:` one, which an app token could otherwise plant for every other client
 * to render. The premade catalog gives `""` for a voice with no preview, so an
 * empty string is accepted and stored as "no preview".
 */
const previewUrlSchema = z.union([z.literal(""), z.string().url().max(2048).startsWith("https://")]).nullable().optional()

const favoriteBody = z.object({
  voiceType: z.enum(VOICE_FAVORITE_TYPES),
  name: z.string().trim().min(1).max(200),
  previewUrl: previewUrlSchema,
})

interface FavoriteRow {
  voice_id: string
  voice_type: VoiceFavorite["voiceType"]
  name: string
  preview_url: string | null
  created_at: string
}

const toFavorite = (row: FavoriteRow): VoiceFavorite => ({
  voiceId: row.voice_id,
  voiceType: row.voice_type,
  name: row.name,
  previewUrl: row.preview_url ?? null,
  createdAt: row.created_at,
})

function unauthorized(reply: FastifyReply) {
  return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
}

function badVoiceId(reply: FastifyReply) {
  return reply.status(400).send({ error: { code: "validation_error", message: "voiceId must be 1–200 characters" } })
}

export async function voiceFavoriteRoutes(app: FastifyInstance) {
  // LIST the caller's favorite voices, newest first.
  app.get("/v1/voices/favorites", { preHandler: requireAppScope("assets:read") }, async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    const { data, error } = await supabase
      .from("voice_favorites")
      .select("voice_id, voice_type, name, preview_url, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
    if (error) return sendInternalError(reply, req, error, "Failed to fetch voice favorites")
    return reply.send({ favorites: ((data ?? []) as FavoriteRow[]).map(toFavorite) })
  })

  // STAR a voice (idempotent: starring it again refreshes the snapshot).
  app.put("/v1/voices/favorites/:voiceId", { preHandler: requireAppScope("assets:write"), config: WRITE_LIMIT }, async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    const voiceId = voiceIdParam.safeParse((req.params as { voiceId?: string }).voiceId)
    if (!voiceId.success) return badVoiceId(reply)
    const parsed = favoriteBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid body" } })
    }

    const { count, error: countError } = await supabase
      .from("voice_favorites")
      .select("user_id", { count: "exact", head: true })
      .eq("user_id", userId)
    if (countError) return sendInternalError(reply, req, countError, "Failed to add voice favorite")
    if ((count ?? 0) >= MAX_VOICE_FAVORITES_PER_USER) {
      // At the cap, re-starring a voice already starred is still a no-op success.
      const { data: already, error: readError } = await supabase
        .from("voice_favorites")
        .select("voice_id")
        .eq("user_id", userId)
        .eq("voice_id", voiceId.data)
      if (readError) return sendInternalError(reply, req, readError, "Failed to add voice favorite")
      if (!already || (already as unknown[]).length === 0) {
        return reply.status(409).send({
          error: { code: "limit_reached", message: `You can star at most ${MAX_VOICE_FAVORITES_PER_USER} voices. Unstar one first.` },
        })
      }
    }

    // The preview column is written only when the client sent one: a re-star without it keeps
    // the stored preview; `""` or `null` clears it on purpose.
    const { previewUrl } = parsed.data
    const row = {
      user_id: userId,
      voice_id: voiceId.data,
      voice_type: parsed.data.voiceType,
      name: parsed.data.name,
      ...(previewUrl !== undefined ? { preview_url: previewUrl === "" ? null : previewUrl } : {}),
    }
    const { data, error } = await supabase
      .from("voice_favorites")
      .upsert(row, { onConflict: "user_id,voice_id" })
      .select("voice_id, voice_type, name, preview_url, created_at")
      .single()
    if (error) return sendInternalError(reply, req, error, "Failed to add voice favorite")
    return reply.send({ favorite: toFavorite(data as FavoriteRow) })
  })

  // UNSTAR a voice (idempotent: removing one that is not there succeeds).
  app.delete("/v1/voices/favorites/:voiceId", { preHandler: requireAppScope("assets:write"), config: WRITE_LIMIT }, async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    const voiceId = voiceIdParam.safeParse((req.params as { voiceId?: string }).voiceId)
    if (!voiceId.success) return badVoiceId(reply)
    const { error } = await supabase.from("voice_favorites").delete().eq("user_id", userId).eq("voice_id", voiceId.data)
    if (error) return sendInternalError(reply, req, error, "Failed to remove voice favorite")
    return reply.send({ success: true })
  })
}
