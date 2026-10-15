import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { requireScope } from "../lib/scopes.js"
import { PRESET_WRITE_LIMIT, presetWriteAccess } from "../lib/presets/write-access.js"
import { sendInternalError } from "../lib/http-errors.js"
import { deletedNothing, sendNotFound } from "../lib/scoped-delete.js"
import { MAX_PRESET_GROUPS_PER_USER, countOwned, isUuid, sendLimitReached } from "../lib/presets/limits.js"

// Reads: the session, a personal key, or an OAuth app with `presets:read`. Writes: the session,
// a personal key, or an OAuth app with `assets:write` (lib/presets/write-access.ts).
const writeOpts = { preHandler: presetWriteAccess, config: PRESET_WRITE_LIMIT }

const createBody = z.object({
  nodeType: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  kind: z.enum(["folder", "section"]).default("folder"),
  sortOrder: z.number().int().optional(),
})

const patchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  sortOrder: z.number().int().optional(),
})

type Row = {
  id: string
  user_id: string
  node_type: string
  name: string
  kind: "folder" | "section"
  sort_order: number | null
  created_at: string
  updated_at: string
}

function toCamel(r: Row) {
  return {
    id: r.id,
    nodeType: r.node_type,
    name: r.name,
    kind: r.kind,
    sortOrder: r.sort_order ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function unauthorized(reply: FastifyReply) {
  return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
}

export async function nodePresetGroupRoutes(app: FastifyInstance) {
  // LIST
  app.get("/v1/node-preset-groups", async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    if (req.appAuthorization) {
      const err = requireScope(req.appAuthorization.scopes, "presets:read")
      if (err) return reply.status(err.statusCode).send(err.body)
    }
    const nodeType = (req.query as { nodeType?: string }).nodeType
    let q = supabase.from("node_preset_groups").select("*").eq("user_id", userId)
    if (nodeType) q = q.eq("node_type", nodeType)
    const { data, error } = await q.order("sort_order", { ascending: true })
    if (error) return sendInternalError(reply, req, error, "Failed to fetch preset groups")
    return reply.send({ data: ((data ?? []) as Row[]).map(toCamel) })
  })

  // CREATE
  app.post("/v1/node-preset-groups", writeOpts, async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    const parsed = createBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid body" } })
    }
    const { nodeType, name, kind, sortOrder } = parsed.data
    try {
      if ((await countOwned("node_preset_groups", userId)) >= MAX_PRESET_GROUPS_PER_USER) {
        return sendLimitReached(reply, `You can keep at most ${MAX_PRESET_GROUPS_PER_USER} preset groups. Delete some first.`)
      }
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to create preset group")
    }
    const { data: row, error } = await supabase
      .from("node_preset_groups")
      .insert({
        user_id: userId,
        node_type: nodeType,
        name,
        kind,
        ...(sortOrder !== undefined ? { sort_order: sortOrder } : {}),
      })
      .select("*")
      .single()
    if (error) return sendInternalError(reply, req, error, "Failed to create preset group")
    return reply.status(201).send({ data: toCamel(row as Row) })
  })

  // UPDATE (rename / reorder)
  app.patch("/v1/node-preset-groups/:id", writeOpts, async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    const id = (req.params as { id: string }).id
    const parsed = patchBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid body" } })
    }
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (parsed.data.name !== undefined) updates.name = parsed.data.name
    if (parsed.data.sortOrder !== undefined) updates.sort_order = parsed.data.sortOrder
    const { data: row, error } = await supabase
      .from("node_preset_groups")
      .update(updates)
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .single()
    if (error) return reply.status(404).send({ error: { code: "not_found", message: "Group not found." } })
    return reply.send({ data: toCamel(row as Row) })
  })

  // DELETE — presets in this group fall back to root (FK ON DELETE SET NULL). A group that is
  // not the caller's, or a malformed id, is a 404.
  app.delete("/v1/node-preset-groups/:id", writeOpts, async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    const id = (req.params as { id: string }).id
    if (!isUuid(id)) return sendNotFound(reply, "Preset group not found")
    const { data, error } = await supabase.from("node_preset_groups").delete().eq("id", id).eq("user_id", userId).select("id")
    if (error) return sendInternalError(reply, req, error, "Failed to delete preset group")
    if (deletedNothing(data)) return sendNotFound(reply, "Preset group not found")
    return reply.send({ data: { success: true } })
  })
}
