import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import {
  SAVED_POST_NOTE_MAX,
  SAVED_POST_SOURCES,
  SAVED_POSTS_LOOKUP_MAX,
  SAVED_POSTS_PAGE_MAX,
  SOCIAL_PLATFORMS,
  normalizeSavedPostTags,
  type SavedPost,
  type SocialPost,
} from "@nodaro/shared"
import { supabase } from "../lib/supabase.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { sendInternalError } from "../lib/http-errors.js"
import { isMissingTableError } from "../lib/postgrest-errors.js"
import { cleanSocialPostSnapshot } from "../lib/saved-post-snapshot.js"
import { mirrorSavedPostStill, deleteSavedPostStill } from "../lib/saved-post-still.js"

/**
 * Saved posts — the inspiration wall (migration 446). Personal data: every
 * query is scoped to the caller's user_id. Table-tolerant: staging and
 * production share one database and the migration lands only on main, so a
 * missing table reads as an empty wall and refuses writes with a 503, never a 500.
 */

const TABLE = "saved_posts"
/** The still's asset rides along, so a copy whose bytes were cleaned up is
 *  never handed out (the asset row survives the cleanup, its url does not). */
const COLUMNS =
  "id, post_id, platform, url, post, thumbnail_asset_id, thumbnail_url, note, tags, source, created_at, updated_at, still:assets!thumbnail_asset_id(r2_url, r2_key)"
/** A post snapshot larger than this is refused (a real post is a few KB). */
const POST_MAX_BYTES = 64 * 1024

type Row = {
  id: string
  post_id: string
  platform: string
  url: string
  post: unknown
  thumbnail_asset_id: string | null
  thumbnail_url: string | null
  note: string
  tags: string[] | null
  source: string
  created_at: string
  updated_at: string
  still?: { r2_url: string | null; r2_key: string | null } | null
}

/** A row as PostgREST returns it: the still is a many-to-one embed (one object
 *  or null), which the untyped client cannot know and types as a list. */
function asRow(data: unknown): Row {
  return data as Row
}

/** True when the save's copied still still has its bytes. */
function hasLiveStill(row: Row): boolean {
  return Boolean(row.thumbnail_asset_id && row.still?.r2_key && row.still.r2_url)
}

export function toSavedPost(row: Row): SavedPost {
  return {
    id: row.id,
    postId: row.post_id,
    platform: row.platform as SavedPost["platform"],
    url: row.url,
    post: row.post as SocialPost,
    thumbnailUrl: hasLiveStill(row) ? row.still!.r2_url : null,
    note: row.note,
    tags: row.tags ?? [],
    source: row.source as SavedPost["source"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function notAvailable(reply: FastifyReply) {
  return reply.status(503).send({ error: { code: "not_available", message: "Saved posts are not available on this server yet." } })
}

const noteSchema = z.string().max(SAVED_POST_NOTE_MAX)
const tagsSchema = z.array(z.string().max(200)).max(50)

const saveBody = z.object({
  post: z.unknown(),
  note: noteSchema.optional(),
  tags: tagsSchema.optional(),
  source: z.enum(SAVED_POST_SOURCES).optional(),
})

const updateBody = z
  .object({ note: noteSchema.optional(), tags: tagsSchema.optional() })
  .refine((b) => b.note !== undefined || b.tags !== undefined, { message: "nothing to update" })

const listQuery = z.object({
  platform: z.enum(SOCIAL_PLATFORMS).optional(),
  tag: z.string().max(200).optional(),
  q: z.string().max(200).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(SAVED_POSTS_PAGE_MAX).default(40),
})

const lookupBody = z.object({ postIds: z.array(z.string().min(1).max(300)).max(SAVED_POSTS_LOOKUP_MAX) })
const idParams = z.object({ id: z.string().uuid() })

/** Words for an ilike filter, with every PostgREST / LIKE special character removed. */
export function searchWords(q: string): string[] {
  return q
    .replace(/[%_*,()\\.:"'`]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0)
    .slice(0, 5)
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The last row of a page, as the next page's starting point (the id breaks
 *  ties between saves made in the same instant). base64url, so the `+` of a
 *  time zone survives a client that puts it in a query string unencoded. */
export function encodeSavedPostsCursor(row: { created_at: string; id: string }): string {
  return Buffer.from(`${row.created_at}|${row.id}`, "utf8").toString("base64url")
}

/** Both halves are spliced into a PostgREST `or(...)` expression, so each must
 *  be exactly a timestamp / a uuid. */
export function parseSavedPostsCursor(cursor: string): { createdAt: string; id: string } | null {
  const raw = /^[A-Za-z0-9_-]+$/.test(cursor) ? Buffer.from(cursor, "base64url").toString("utf8") : ""
  const separator = raw.lastIndexOf("|")
  if (separator === -1) return null
  const createdAt = raw.slice(0, separator)
  const id = raw.slice(separator + 1)
  return ISO_TIMESTAMP.test(createdAt) && !Number.isNaN(Date.parse(createdAt)) && UUID.test(id) ? { createdAt, id } : null
}

function validationError(reply: FastifyReply, error: z.ZodError) {
  return reply.status(400).send({ error: { code: "validation_error", message: error.issues[0]?.message ?? "invalid request" } })
}

function requireUser(req: FastifyRequest, reply: FastifyReply): string | null {
  if (!req.userId) {
    void reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    return null
  }
  return req.userId
}

type Outcome = { readonly status: number; readonly row?: Row; readonly error?: unknown }

/**
 * A post already saved: apply the note and tags given, and copy the still
 * when the save has none (never copied, or its bytes were cleaned up). The
 * copy is set only if no other request set one first (compare-and-set on the
 * asset id); a lost race keeps the note and tags and drops this copy.
 */
async function updateExisting(userId: string, current: Row, post: SocialPost, patch: Record<string, unknown>): Promise<Outcome> {
  const still = hasLiveStill(current) ? null : await mirrorSavedPostStill(userId, post)
  const fields = { ...patch, ...(still ? { thumbnail_asset_id: still.assetId, thumbnail_url: still.url } : {}) }
  if (Object.keys(fields).length === 0) return { status: 200, row: current }

  const now = new Date().toISOString()
  const base = supabase.from(TABLE).update({ ...fields, updated_at: now }).eq("id", current.id).eq("user_id", userId)
  const guarded = still ? (current.thumbnail_asset_id ? base.eq("thumbnail_asset_id", current.thumbnail_asset_id) : base.is("thumbnail_asset_id", null)) : base
  const updated = await guarded.select(COLUMNS).maybeSingle()
  if (!updated.error && updated.data) {
    // A replaced copy had lost its bytes; its asset row is all that is left of it.
    if (still && current.thumbnail_asset_id) await deleteSavedPostStill(userId, current.thumbnail_asset_id)
    return { status: 200, row: asRow(updated.data) }
  }

  if (still) await deleteSavedPostStill(userId, still.assetId)
  if (updated.error) return { status: 500, error: updated.error }
  if (Object.keys(patch).length === 0) {
    const again = await supabase.from(TABLE).select(COLUMNS).eq("id", current.id).eq("user_id", userId).maybeSingle()
    return again.data ? { status: 200, row: asRow(again.data) } : { status: 409 }
  }
  const retry = await supabase.from(TABLE).update({ ...patch, updated_at: now }).eq("id", current.id).eq("user_id", userId).select(COLUMNS).maybeSingle()
  if (retry.error) return { status: 500, error: retry.error }
  return retry.data ? { status: 200, row: asRow(retry.data) } : { status: 409 }
}

function sendOutcome(reply: FastifyReply, req: FastifyRequest, outcome: Outcome) {
  if (outcome.row) return reply.status(outcome.status).send(toSavedPost(outcome.row))
  if (outcome.status === 409) {
    return reply.status(409).send({ error: { code: "conflict", message: "The save changed while saving. Try again." } })
  }
  return sendInternalError(reply, req, outcome.error, "Failed to save the post")
}

export async function savedPostRoutes(app: FastifyInstance) {
  app.get("/v1/saved-posts", { preHandler: requireAppScope("assets:read") }, async (req, reply) => {
    const userId = requireUser(req, reply)
    if (!userId) return
    const parsed = listQuery.safeParse(req.query)
    if (!parsed.success) return validationError(reply, parsed.error)
    const { platform, tag, q, cursor, limit } = parsed.data
    const after = cursor ? parseSavedPostsCursor(cursor) : null
    if (cursor && !after) {
      return reply.status(400).send({ error: { code: "invalid_cursor", message: "That cursor is not one this list gave out." } })
    }

    let query = supabase.from(TABLE).select(COLUMNS).eq("user_id", userId)
    if (platform) query = query.eq("platform", platform)
    // A normalized tag holds no comma, brace, quote or backslash, so the
    // quoted array literal below cannot be broken out of.
    const tagValue = tag ? normalizeSavedPostTags([tag])[0] : undefined
    if (tagValue) query = query.filter("tags", "cs", `{"${tagValue}"}`)
    for (const word of searchWords(q ?? "")) {
      query = query.or(`note.ilike.*${word}*,post->>text.ilike.*${word}*,post->>title.ilike.*${word}*`)
    }
    if (after) query = query.or(`created_at.lt.${after.createdAt},and(created_at.eq.${after.createdAt},id.lt.${after.id})`)
    const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1)
    if (isMissingTableError(error)) return { data: [], nextCursor: null }
    if (error) return sendInternalError(reply, req, error, "Failed to load saved posts")
    const rows = ((data ?? []) as unknown[]).map(asRow)
    const page = rows.slice(0, limit)
    return { data: page.map(toSavedPost), nextCursor: rows.length > limit ? encodeSavedPostsCursor(page[page.length - 1]!) : null }
  })

  app.post("/v1/saved-posts/lookup", { preHandler: requireAppScope("assets:read") }, async (req, reply) => {
    const userId = requireUser(req, reply)
    if (!userId) return
    const parsed = lookupBody.safeParse(req.body)
    if (!parsed.success) return validationError(reply, parsed.error)
    if (parsed.data.postIds.length === 0) return { saved: [] }
    const { data, error } = await supabase
      .from(TABLE)
      .select("id, post_id")
      .eq("user_id", userId)
      .in("post_id", parsed.data.postIds)
    if (isMissingTableError(error)) return { saved: [] }
    if (error) return sendInternalError(reply, req, error, "Failed to look up saved posts")
    return { saved: ((data ?? []) as Array<{ id: string; post_id: string }>).map((r) => ({ postId: r.post_id, id: r.id })) }
  })

  app.post(
    "/v1/saved-posts",
    // Each new save fetches a still and writes it to storage: bounded per user.
    { preHandler: requireAppScope("assets:write"), config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const userId = requireUser(req, reply)
      if (!userId) return
      const parsed = saveBody.safeParse(req.body)
      if (!parsed.success) return validationError(reply, parsed.error)
      const post = cleanSocialPostSnapshot(parsed.data.post)
      if (!post) {
        return reply.status(400).send({ error: { code: "validation_error", message: "post must be a Social Search post" } })
      }
      if (JSON.stringify(post).length > POST_MAX_BYTES) {
        return reply.status(413).send({ error: { code: "post_too_large", message: "That post is too large to save." } })
      }
      const { note, tags, source } = parsed.data
      const patch = {
        ...(note !== undefined ? { note } : {}),
        ...(tags !== undefined ? { tags: normalizeSavedPostTags(tags) } : {}),
      }

      // Saving a post already saved: keep the save, update what was given.
      const existing = await supabase.from(TABLE).select(COLUMNS).eq("user_id", userId).eq("post_id", post.id).maybeSingle()
      if (isMissingTableError(existing.error)) return notAvailable(reply)
      if (existing.error) return sendInternalError(reply, req, existing.error, "Failed to save the post")
      if (existing.data) return sendOutcome(reply, req, await updateExisting(userId, asRow(existing.data), post, patch))

      // A new save: copy the still first (best effort; the save never fails on it).
      const still = await mirrorSavedPostStill(userId, post)
      const inserted = await supabase
        .from(TABLE)
        .insert({
          user_id: userId,
          post_id: post.id,
          platform: post.platform,
          url: post.url,
          post,
          thumbnail_asset_id: still?.assetId ?? null,
          thumbnail_url: still?.url ?? null,
          note: note ?? "",
          tags: normalizeSavedPostTags(tags ?? []),
          source: source ?? "api",
        })
        .select(COLUMNS)
        .single()
      if (!inserted.error) return reply.status(201).send(toSavedPost(asRow(inserted.data)))

      if (still) await deleteSavedPostStill(userId, still.assetId)
      if (isMissingTableError(inserted.error)) return notAvailable(reply)
      if (inserted.error.code === "23505") {
        // A second save of the same post won the race: apply this one's note and tags to it.
        const winner = await supabase.from(TABLE).select(COLUMNS).eq("user_id", userId).eq("post_id", post.id).maybeSingle()
        if (winner.data) return sendOutcome(reply, req, await updateExisting(userId, asRow(winner.data), post, patch))
      }
      return sendInternalError(reply, req, inserted.error, "Failed to save the post")
    },
  )

  app.patch("/v1/saved-posts/:id", { preHandler: requireAppScope("assets:write") }, async (req, reply) => {
    const userId = requireUser(req, reply)
    if (!userId) return
    const params = idParams.safeParse(req.params)
    if (!params.success) return validationError(reply, params.error)
    const parsed = updateBody.safeParse(req.body)
    if (!parsed.success) return validationError(reply, parsed.error)
    const { note, tags } = parsed.data
    const { data, error } = await supabase
      .from(TABLE)
      .update({
        ...(note !== undefined ? { note } : {}),
        ...(tags !== undefined ? { tags: normalizeSavedPostTags(tags) } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.data.id)
      .eq("user_id", userId)
      .select(COLUMNS)
      .maybeSingle()
    if (isMissingTableError(error)) return notAvailable(reply)
    if (error) return sendInternalError(reply, req, error, "Failed to update the saved post")
    if (!data) return reply.status(404).send({ error: { code: "not_found", message: "Saved post not found" } })
    return toSavedPost(asRow(data))
  })

  app.delete("/v1/saved-posts/:id", { preHandler: requireAppScope("assets:write") }, async (req, reply) => {
    const userId = requireUser(req, reply)
    if (!userId) return
    const params = idParams.safeParse(req.params)
    if (!params.success) return validationError(reply, params.error)
    const { data, error } = await supabase
      .from(TABLE)
      .delete()
      .eq("id", params.data.id)
      .eq("user_id", userId)
      .select("id, thumbnail_asset_id")
      .maybeSingle()
    if (isMissingTableError(error)) return notAvailable(reply)
    if (error) return sendInternalError(reply, req, error, "Failed to delete the saved post")
    if (!data) return reply.status(404).send({ error: { code: "not_found", message: "Saved post not found" } })
    const assetId = (data as { thumbnail_asset_id: string | null }).thumbnail_asset_id
    if (assetId) await deleteSavedPostStill(userId, assetId)
    return { success: true }
  })
}
