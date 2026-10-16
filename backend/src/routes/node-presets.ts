import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { sendInternalError } from "../lib/http-errors.js"
import { z } from "zod"
import { portablePresetData, presetCatalog } from "../lib/presets/app-presets.js"
import { factoryPresetView, referenceFields } from "../lib/presets/preset-view.js"
import { releasePresetPreviews, storePresetPreviews } from "../lib/presets/preview-copy.js"
import { PREVIEW_URL_MAX_LENGTH, previewStorageKey, previewUrlProblem } from "../lib/presets/preview-url.js"
import {
  MAX_PRESETS_PER_USER,
  MAX_PRESET_FAVORITES_PER_USER,
  REORDER_CONCURRENCY,
  countOwned,
  inBatches,
  isUuid,
  reorderLimitsFor,
  sendLimitReached,
} from "../lib/presets/limits.js"
import { PRESET_IMPORT_LIMIT, PRESET_WRITE_LIMIT, presetWriteAccess } from "../lib/presets/write-access.js"
import { deletedNothing, sendNotFound } from "../lib/scoped-delete.js"
import { supabase } from "../lib/supabase.js"
import { requireScope } from "../lib/scopes.js"

const MAX_DATA_BYTES = 64 * 1024

// Reads of the user's own library: the session, a personal key, or an OAuth app
// with `presets:read`. The factory catalog (`GET /v1/node-presets/factory`)
// takes no credential at all — see the route.
// Writes (create / update / delete / import / reorder / favorites): the
// session, a personal key, or an OAuth app with `assets:write`
// (lib/presets/write-access.ts — which also says who is refused, and why).

const presetDataSchema = z
  .record(z.string(), z.unknown())
  .refine((d) => JSON.stringify(d).length <= MAX_DATA_BYTES, { message: "preset data too large" })

const tagsSchema = z.array(z.string().min(1).max(40)).max(32)
const groupIdSchema = z.string().uuid().nullable()
/** An image this platform stores (lib/presets/preview-url.ts); null = no preview. */
const previewUrlSchema = z.string().url().max(PREVIEW_URL_MAX_LENGTH).nullable()

const createBody = z.object({
  nodeType: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  data: presetDataSchema,
  groupId: groupIdSchema.optional(),
  tags: tagsSchema.optional(),
  sortOrder: z.number().int().optional(),
  previewUrl: previewUrlSchema.optional(),
})

const expectedUpdatedAt = z.string().max(64).refine(v => Number.isFinite(Date.parse(v)), "Invalid timestamp")

const patchBody = z.object({
  expectedUpdatedAt: expectedUpdatedAt.optional(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  data: presetDataSchema.optional(),
  groupId: groupIdSchema.optional(),
  tags: tagsSchema.optional(),
  sortOrder: z.number().int().optional(),
  previewUrl: previewUrlSchema.optional(),
})

// The widest bounds (a session's); a key or an app gets less (lib/presets/limits.ts).
const reorderBody = z.object({
  groups: z.array(z.object({ id: z.string().uuid(), sortOrder: z.number().int() })).max(500).optional(),
  presets: z
    .array(z.object({ id: z.string().uuid(), groupId: groupIdSchema.optional(), sortOrder: z.number().int() }))
    .max(2000)
    .optional(),
})

const importBody = z.object({
  presets: z
    .array(
      z.object({
        nodeType: z.string().min(1).max(120),
        name: z.string().min(1).max(120),
        description: z.string().max(500).optional(),
        data: presetDataSchema,
        previewUrl: previewUrlSchema.optional(),
      }),
    )
    .max(500),
})

// A favorite points at a factory preset id ("generate-image/character-board") OR a
// user-preset uuid (as text) — both fit `presetId`.
const favoriteBody = z.object({
  nodeType: z.string().min(1).max(120),
  presetId: z.string().min(1).max(200),
})

type Row = {
  id: string
  user_id: string
  node_type: string
  name: string
  description: string | null
  data: Record<string, unknown>
  group_id: string | null
  tags: string[] | null
  sort_order: number | null
  /** Migration 523; absent on a database that predates it. */
  preview_url?: string | null
  created_at: string
  updated_at: string
}

function toCamel(r: Row) {
  const data = portablePresetData(r.node_type, r.data ?? {}) ?? {}
  return {
    id: r.id,
    nodeType: r.node_type,
    name: r.name,
    description: r.description ?? undefined,
    data,
    groupId: r.group_id ?? undefined,
    tags: r.tags ?? [],
    sortOrder: r.sort_order ?? 0,
    ...referenceFields(r.node_type, data),
    previewUrl: r.preview_url ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function unauthorized(reply: FastifyReply) {
  return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
}

function invalid(reply: FastifyReply, message: string) {
  return reply.status(400).send({ error: { code: "validation_error", message } })
}

/**
 * Checks the preview URLs a write sets. Answers the request (400 naming the
 * first bad one, or 500 when the storage cannot be asked) and returns true
 * when the write must stop.
 */
async function rejectBadPreviews(
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  entries: ReadonlyArray<{ label: string; url: string | null | undefined }>,
): Promise<boolean> {
  const set = entries.filter((e): e is { label: string; url: string } => typeof e.url === "string")
  if (set.length === 0) return false
  try {
    const problem = await previewUrlProblem(userId, set)
    if (problem === null) return false
    invalid(reply, problem)
  } catch (err) {
    sendInternalError(reply, req, err, "Failed to check the preview image")
  }
  return true
}

/**
 * The preset's own copies of checked preview URLs (lib/presets/preview-copy.ts):
 * for each URL given, the address to store. Answers 500 and returns null when a
 * copy fails.
 */
async function storePreviews(
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  urls: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, string> | null> {
  const given = [...new Set(urls.filter((u): u is string => typeof u === "string"))]
  if (given.length === 0) return new Map()
  try {
    const byKey = await storePresetPreviews(userId, given.map((u) => previewStorageKey(u)!))
    return new Map(given.map((u) => [u, byKey.get(previewStorageKey(u)!)!] as const))
  } catch (err) {
    sendInternalError(reply, req, err, "Failed to store the preview image")
    return null
  }
}

/** Returns the subset of `ids` that are NOT groups owned by `userId` (so a preset can never be
 *  assigned to another user's group — keeps group_id references correct-by-construction). */
async function unownedGroupIds(userId: string, ids: string[]): Promise<string[]> {
  const distinct = [...new Set(ids)]
  if (distinct.length === 0) return []
  const { data } = await supabase
    .from("node_preset_groups")
    .select("id")
    .eq("user_id", userId)
    .in("id", distinct)
  const owned = new Set(((data ?? []) as { id: string }[]).map((r) => r.id))
  return distinct.filter((id) => !owned.has(id))
}

const writeOpts = { preHandler: presetWriteAccess, config: PRESET_WRITE_LIMIT }

export async function nodePresetRoutes(app: FastifyInstance) {
  // LIST (user's custom presets)
  app.get("/v1/node-presets", async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    if (req.appAuthorization) {
      const err = requireScope(req.appAuthorization.scopes, "presets:read")
      if (err) return reply.status(err.statusCode).send(err.body)
    }
    const nodeType = (req.query as { nodeType?: string }).nodeType
    let q = supabase.from("node_presets").select("*").eq("user_id", userId)
    if (nodeType) q = q.eq("node_type", nodeType)
    const { data, error } = await q.order("created_at", { ascending: false })
    if (error) return sendInternalError(reply, req, error, "Failed to fetch node presets")
    return reply.send({ data: ((data ?? []) as Row[]).map(toCamel) })
  })

  // FACTORY (built-in) presets — read-only catalog from the node and app registries. Lets SDK/CLI/MCP
  // clients list and USE the shipped presets (their `data` merges into a node's config), with how
  // many reference photos each works from and its example picture (lib/presets/preset-view.ts).
  // Static path "/factory" is matched ahead of any `:id` route (there is no GET /:id here).
  // PUBLIC (middleware/auth.ts PUBLIC_ROUTES): the catalog is the deployment's — a pure function of
  // its configuration, the same for every caller, holding no user data — so it needs no identity
  // and asks an OAuth app for no scope; a client app shows it to visitors who are not signed in.
  // Nothing here may read `req.userId`: the response is cached as public, like /v1/models.
  app.get("/v1/node-presets/factory", async (req, reply) => {
    const nodeType = (req.query as { nodeType?: string }).nodeType
    if (!nodeType) {
      return reply.status(400).send({ error: { code: "validation_error", message: "nodeType query param is required" } })
    }
    const data = presetCatalog(nodeType).map((p) => factoryPresetView(nodeType, p))
    reply.header("Cache-Control", "public, max-age=300")
    return reply.send({ data })
  })

  // FAVORITES — per-user starred presets (factory OR user). Powers the dropdown's "Favorites"
  // band (which replaced the static "Popular" band). Static "/favorites" paths are matched
  // ahead of the parametric "/:id" routes by the router (find-my-way: static > parametric).
  // LIST favorite preset ids for a node type, most-recent first.
  app.get("/v1/node-presets/favorites", async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    if (req.appAuthorization) {
      const err = requireScope(req.appAuthorization.scopes, "presets:read")
      if (err) return reply.status(err.statusCode).send(err.body)
    }
    const nodeType = (req.query as { nodeType?: string }).nodeType
    if (!nodeType) {
      return reply.status(400).send({ error: { code: "validation_error", message: "nodeType query param is required" } })
    }
    const { data, error } = await supabase
      .from("node_preset_favorites")
      .select("preset_id")
      .eq("user_id", userId)
      .eq("node_type", nodeType)
      .order("created_at", { ascending: false })
    if (error) return sendInternalError(reply, req, error, "Failed to fetch favorites")
    return reply.send({ data: ((data ?? []) as { preset_id: string }[]).map((r) => r.preset_id) })
  })

  // ADD a favorite (idempotent on the unique constraint).
  app.post("/v1/node-presets/favorites", writeOpts, async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    const parsed = favoriteBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid body" } })
    }
    try {
      if ((await countOwned("node_preset_favorites", userId)) >= MAX_PRESET_FAVORITES_PER_USER) {
        // At the cap, starring one already starred is still a no-op success.
        const { data: already, error: readError } = await supabase
          .from("node_preset_favorites")
          .select("preset_id")
          .eq("user_id", userId)
          .eq("node_type", parsed.data.nodeType)
          .eq("preset_id", parsed.data.presetId)
        if (readError) throw new Error(readError.message)
        if (deletedNothing(already as unknown[] | null)) {
          return sendLimitReached(reply, `You can star at most ${MAX_PRESET_FAVORITES_PER_USER} presets. Unstar one first.`)
        }
        return reply.send({ data: { success: true } })
      }
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to add favorite")
    }
    const { error } = await supabase
      .from("node_preset_favorites")
      .upsert(
        { user_id: userId, node_type: parsed.data.nodeType, preset_id: parsed.data.presetId },
        { onConflict: "user_id,node_type,preset_id", ignoreDuplicates: true },
      )
    if (error) return sendInternalError(reply, req, error, "Failed to add favorite")
    return reply.send({ data: { success: true } })
  })

  // REMOVE a favorite (idempotent: removing one that is not there succeeds). Query params
  // because factory presetIds contain "/".
  app.delete("/v1/node-presets/favorites", writeOpts, async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    const q = req.query as { nodeType?: string; presetId?: string }
    if (!q.nodeType || !q.presetId) {
      return reply.status(400).send({ error: { code: "validation_error", message: "nodeType and presetId query params are required" } })
    }
    const { error } = await supabase
      .from("node_preset_favorites")
      .delete()
      .eq("user_id", userId)
      .eq("node_type", q.nodeType)
      .eq("preset_id", q.presetId)
    if (error) return sendInternalError(reply, req, error, "Failed to remove favorite")
    return reply.send({ data: { success: true } })
  })

  // CREATE
  app.post("/v1/node-presets", writeOpts, async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    const parsed = createBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid body" } })
    }
    const { nodeType, name, description, data, groupId, tags, sortOrder, previewUrl } = parsed.data
    const portable = portablePresetData(nodeType, data)
    if (!portable) return reply.status(400).send({ error: { code: "validation_error", message: "Invalid settings for this preset type." } })
    if (groupId && (await unownedGroupIds(userId, [groupId])).length > 0) {
      return reply.status(400).send({ error: { code: "invalid_group", message: "Group not found." } })
    }
    if (await rejectBadPreviews(req, reply, userId, [{ label: "previewUrl", url: previewUrl }])) return reply
    try {
      if ((await countOwned("node_presets", userId)) >= MAX_PRESETS_PER_USER) {
        return sendLimitReached(reply, `You can keep at most ${MAX_PRESETS_PER_USER} presets. Delete some first.`)
      }
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to create preset")
    }
    const stored = await storePreviews(req, reply, userId, [previewUrl])
    if (!stored) return reply
    const storedPreview = previewUrl ? stored.get(previewUrl) : undefined
    const { data: row, error } = await supabase
      .from("node_presets")
      .insert({
        user_id: userId,
        node_type: nodeType,
        name,
        description: description ?? null,
        data: portable,
        ...(groupId !== undefined ? { group_id: groupId } : {}),
        ...(tags !== undefined ? { tags } : {}),
        ...(sortOrder !== undefined ? { sort_order: sortOrder } : {}),
        // Only when set: a database that predates migration 523 has no such column.
        ...(storedPreview ? { preview_url: storedPreview } : {}),
      })
      .select("*")
      .single()
    if (error) {
      await releasePresetPreviews(userId, [storedPreview])
      if (error.code === "23505") {
        return reply.status(409).send({ error: { code: "name_taken", message: "A preset with that name already exists for this node type." } })
      }
      return sendInternalError(reply, req, error, "Failed to create preset")
    }
    return reply.status(201).send({ data: toCamel(row as Row) })
  })

  // UPDATE (rename / override data / set the preview) — powers the dropdown's "Override" action.
  app.patch("/v1/node-presets/:id", writeOpts, async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    const id = (req.params as { id: string }).id
    const parsed = patchBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid body" } })
    }
    if (parsed.data.groupId && (await unownedGroupIds(userId, [parsed.data.groupId])).length > 0) {
      return reply.status(400).send({ error: { code: "invalid_group", message: "Group not found." } })
    }
    // Resolve the namespace from the OWNED row, never from caller-controlled data.
    const { data: current, error: readError } = await supabase.from("node_presets")
      .select("*").eq("id", id).eq("user_id", userId).single()
    if (readError || !current) return reply.status(404).send({ error: { code: "not_found", message: "Preset not found." } })
    const before = current as Row
    const portable = parsed.data.data === undefined ? undefined : portablePresetData(before.node_type, parsed.data.data)
    if (portable === null) return reply.status(400).send({ error: { code: "validation_error", message: "Invalid settings for this preset type." } })
    if (await rejectBadPreviews(req, reply, userId, [{ label: "previewUrl", url: parsed.data.previewUrl }])) return reply
    const stored = await storePreviews(req, reply, userId, [parsed.data.previewUrl])
    if (!stored) return reply
    const newPreview = parsed.data.previewUrl ? stored.get(parsed.data.previewUrl) : parsed.data.previewUrl
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (parsed.data.name !== undefined) updates.name = parsed.data.name
    if (parsed.data.description !== undefined) updates.description = parsed.data.description
    if (portable !== undefined) updates.data = portable
    if (parsed.data.groupId !== undefined) updates.group_id = parsed.data.groupId
    if (parsed.data.tags !== undefined) updates.tags = parsed.data.tags
    if (parsed.data.sortOrder !== undefined) updates.sort_order = parsed.data.sortOrder
    if (newPreview !== undefined) updates.preview_url = newPreview
    let update = supabase.from("node_presets").update(updates).eq("id", id).eq("user_id", userId)
    if (parsed.data.expectedUpdatedAt) update = update.eq("updated_at", parsed.data.expectedUpdatedAt)
    const { data: row, error } = await update.select("*").single()
    // A failed write lets the new copy go; a done one lets the replaced picture go.
    await releasePresetPreviews(userId, error ? [newPreview] : newPreview !== undefined ? [before.preview_url] : [])
    if (error?.code === "PGRST116" && parsed.data.expectedUpdatedAt) {
      return reply.status(409).send({ error: { code: "conflict", message: "This preset changed on another device. Refresh and try again." } })
    }
    if (error) {
      if (error.code === "23505") {
        return reply.status(409).send({ error: { code: "name_taken", message: "Name already exists." } })
      }
      return reply.status(404).send({ error: { code: "not_found", message: "Preset not found." } })
    }
    return reply.send({ data: toCamel(row as Row) })
  })

  // DELETE — a preset that is not the caller's (or no longer exists, or a malformed id) is a 404.
  app.delete("/v1/node-presets/:id", writeOpts, async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    const id = (req.params as { id: string }).id
    if (!isUuid(id)) return sendNotFound(reply, "Preset not found.")
    const query = z.object({ expectedUpdatedAt: expectedUpdatedAt.optional() }).safeParse(req.query)
    if (!query.success) return reply.status(400).send({ error: { code: "validation_error", message: "Invalid timestamp." } })
    let deleted: Row | undefined
    if (query.data.expectedUpdatedAt) {
      // Whose it is first: a preset that is not the caller's is a 404, never a "changed" 409.
      const { data: owned, error: readError } = await supabase
        .from("node_presets").select("id").eq("id", id).eq("user_id", userId)
      if (readError) return sendInternalError(reply, req, readError, "Failed to delete preset")
      if (deletedNothing(owned as unknown[] | null)) return sendNotFound(reply, "Preset not found.")
      // With a revision, nothing deleted means it changed (or went) since the caller read it.
      const { data, error } = await supabase.from("node_presets").delete().eq("id", id).eq("user_id", userId)
        .eq("updated_at", query.data.expectedUpdatedAt).select("*").single()
      if (error?.code === "PGRST116") {
        return reply.status(409).send({ error: { code: "conflict", message: "This preset changed on another device. Refresh and try again." } })
      }
      if (error) return sendInternalError(reply, req, error, "Failed to delete preset")
      deleted = data as Row
    } else {
      const { data, error } = await supabase.from("node_presets").delete().eq("id", id).eq("user_id", userId).select("*")
      if (error) return sendInternalError(reply, req, error, "Failed to delete preset")
      if (deletedNothing(data as unknown[] | null)) return sendNotFound(reply, "Preset not found.")
      deleted = (data as Row[])[0]
    }
    // Best-effort: drop any favorite rows pointing at this now-deleted user preset
    // (preset_id is polymorphic → no FK cascade). Non-fatal if it errors.
    await supabase.from("node_preset_favorites").delete().eq("preset_id", id).eq("user_id", userId)
    await releasePresetPreviews(userId, [deleted?.preview_url])
    return reply.send({ data: { success: true } })
  })

  // IMPORT (bulk insert with name-collision suffixing)
  app.post("/v1/node-presets/import", { preHandler: presetWriteAccess, config: PRESET_IMPORT_LIMIT }, async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    const parsed = importBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid body" } })
    }

    const portable = parsed.data.presets.map(p => ({ ...p, data: portablePresetData(p.nodeType, p.data) }))
    if (portable.some(p => p.data === null)) return reply.status(400).send({ error: { code: "validation_error", message: "Invalid settings for this preset type." } })
    const previews = parsed.data.presets.map((p, i) => ({ label: `presets[${i}].previewUrl`, url: p.previewUrl }))
    if (await rejectBadPreviews(req, reply, userId, previews)) return reply

    // Load existing (type,name) to avoid unique-violation churn on import (and to count them).
    const { data: existing, error: existingError } = await supabase.from("node_presets").select("node_type,name").eq("user_id", userId)
    if (existingError) return sendInternalError(reply, req, existingError, "Failed to import presets")
    const taken = new Set(
      ((existing ?? []) as { node_type: string; name: string }[]).map((r) => `${r.node_type}::${r.name.toLowerCase()}`),
    )

    const rows = portable
      // Skip presets that carry no portable config after stripping (useless empty rows).
      .filter((p) => p.data && Object.keys(p.data).length > 0)
      .map((p) => {
        let name = p.name
        let i = 2
        while (taken.has(`${p.nodeType}::${name.toLowerCase()}`)) name = `${p.name} (imported ${i++})`
        taken.add(`${p.nodeType}::${name.toLowerCase()}`)
        return {
          user_id: userId,
          node_type: p.nodeType,
          name,
          description: p.description ?? null,
          data: p.data,
          previewUrl: p.previewUrl,
        }
      })

    if (rows.length === 0) return reply.send({ data: { imported: 0 } })
    // Counted, not read off the list above: a list read is capped at the API's row limit.
    let room: number
    try {
      room = MAX_PRESETS_PER_USER - (await countOwned("node_presets", userId))
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to import presets")
    }
    if (rows.length > room) {
      return sendLimitReached(
        reply,
        `You can keep at most ${MAX_PRESETS_PER_USER} presets; this import adds ${rows.length} and there is room for ${Math.max(0, room)}.`,
      )
    }
    const stored = await storePreviews(req, reply, userId, rows.map((r) => r.previewUrl))
    if (!stored) return reply
    const inserts = rows.map(({ previewUrl, ...row }) => {
      const preview = previewUrl ? stored.get(previewUrl) : undefined
      // Only when set: a database that predates migration 523 has no such column.
      return preview ? { ...row, preview_url: preview } : row
    })
    const { error } = await supabase.from("node_presets").insert(inserts)
    if (error) {
      await releasePresetPreviews(userId, [...stored.values()])
      return sendInternalError(reply, req, error, "Failed to import presets")
    }
    return reply.send({ data: { imported: rows.length } })
  })

  // REORDER — bulk-apply positions (and preset group membership) after a drag in the Manage dialog.
  // Every update is scoped by user_id, so foreign ids silently no-op. One update per row, run
  // REORDER_CONCURRENCY at a time; how many rows one call may move depends on the caller.
  app.post("/v1/node-presets/reorder", writeOpts, async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    const parsed = reorderBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid body" } })
    }
    const groups = parsed.data.groups ?? []
    const presets = parsed.data.presets ?? []
    const limits = reorderLimitsFor(req)
    if (groups.length > limits.groups || presets.length > limits.presets) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: `One reorder moves at most ${limits.presets} presets and ${limits.groups} groups; send the rest in another call.`,
        },
      })
    }
    // A preset may only be moved into one of the caller's own groups.
    const targetGroupIds = presets
      .map((p) => p.groupId)
      .filter((g): g is string => typeof g === "string")
    if ((await unownedGroupIds(userId, targetGroupIds)).length > 0) {
      return reply.status(400).send({ error: { code: "invalid_group", message: "Group not found." } })
    }
    const now = new Date().toISOString()
    const updates: Array<() => PromiseLike<{ error: unknown }>> = [
      ...groups.map((g) => () =>
        supabase.from("node_preset_groups").update({ sort_order: g.sortOrder, updated_at: now }).eq("id", g.id).eq("user_id", userId),
      ),
      ...presets.map((p) => () =>
        supabase
          .from("node_presets")
          .update({ sort_order: p.sortOrder, updated_at: now, ...(p.groupId !== undefined ? { group_id: p.groupId } : {}) })
          .eq("id", p.id)
          .eq("user_id", userId),
      ),
    ]
    const results = await inBatches(updates, REORDER_CONCURRENCY, async (run) => {
      const { error } = await run()
      return { error }
    })
    if (results.some((r) => r.error)) {
      return sendInternalError(reply, req, undefined, "Reorder failed")
    }
    return reply.send({ data: { ok: true } })
  })
}
