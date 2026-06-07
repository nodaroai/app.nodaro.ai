import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import { extractPresetData, getFactoryPresets, getPopularFactoryPresets } from "@nodaro/shared"
import { supabase } from "../lib/supabase.js"
import { requireScope } from "../lib/scopes.js"

const MAX_DATA_BYTES = 64 * 1024

const presetDataSchema = z
  .record(z.string(), z.unknown())
  .refine((d) => JSON.stringify(d).length <= MAX_DATA_BYTES, { message: "preset data too large" })

const tagsSchema = z.array(z.string().min(1).max(40)).max(32)
const groupIdSchema = z.string().uuid().nullable()

const createBody = z.object({
  nodeType: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  data: presetDataSchema,
  groupId: groupIdSchema.optional(),
  tags: tagsSchema.optional(),
  sortOrder: z.number().int().optional(),
})

const patchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  data: presetDataSchema.optional(),
  groupId: groupIdSchema.optional(),
  tags: tagsSchema.optional(),
  sortOrder: z.number().int().optional(),
})

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
      }),
    )
    .max(500),
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
  created_at: string
  updated_at: string
}

function toCamel(r: Row) {
  return {
    id: r.id,
    nodeType: r.node_type,
    name: r.name,
    description: r.description ?? undefined,
    data: r.data ?? {},
    groupId: r.group_id ?? undefined,
    tags: r.tags ?? [],
    sortOrder: r.sort_order ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function unauthorized(reply: FastifyReply) {
  return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
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
    if (error) return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    return reply.send({ data: ((data ?? []) as Row[]).map(toCamel) })
  })

  // FACTORY (built-in) presets — read-only catalog from @nodaro/shared. Lets SDK/CLI/MCP
  // clients list and USE the shipped presets (their `data` merges into a node's config).
  // Static path "/factory" is matched ahead of any `:id` route (there is no GET /:id here).
  app.get("/v1/node-presets/factory", async (req, reply) => {
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
    const data = getFactoryPresets(nodeType).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      group: p.group,
      groupKind: p.groupKind,
      data: p.data,
    }))
    const popularIds = getPopularFactoryPresets(nodeType).map((p) => p.id)
    return reply.send({ data, popularIds })
  })

  // CREATE
  app.post("/v1/node-presets", async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    const parsed = createBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid body" } })
    }
    const { nodeType, name, description, data, groupId, tags, sortOrder } = parsed.data
    if (groupId && (await unownedGroupIds(userId, [groupId])).length > 0) {
      return reply.status(400).send({ error: { code: "invalid_group", message: "Group not found." } })
    }
    const { data: row, error } = await supabase
      .from("node_presets")
      .insert({
        user_id: userId,
        node_type: nodeType,
        name,
        description: description ?? null,
        data: extractPresetData(data), // defensive strip
        ...(groupId !== undefined ? { group_id: groupId } : {}),
        ...(tags !== undefined ? { tags } : {}),
        ...(sortOrder !== undefined ? { sort_order: sortOrder } : {}),
      })
      .select("*")
      .single()
    if (error) {
      if (error.code === "23505") {
        return reply.status(409).send({ error: { code: "name_taken", message: "A preset with that name already exists for this node type." } })
      }
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }
    return reply.status(201).send({ data: toCamel(row as Row) })
  })

  // UPDATE (rename / override data) — powers the dropdown's "Override" action.
  app.patch("/v1/node-presets/:id", async (req, reply) => {
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
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (parsed.data.name !== undefined) updates.name = parsed.data.name
    if (parsed.data.description !== undefined) updates.description = parsed.data.description
    if (parsed.data.data !== undefined) updates.data = extractPresetData(parsed.data.data)
    if (parsed.data.groupId !== undefined) updates.group_id = parsed.data.groupId
    if (parsed.data.tags !== undefined) updates.tags = parsed.data.tags
    if (parsed.data.sortOrder !== undefined) updates.sort_order = parsed.data.sortOrder
    const { data: row, error } = await supabase
      .from("node_presets")
      .update(updates)
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .single()
    if (error) {
      if (error.code === "23505") {
        return reply.status(409).send({ error: { code: "name_taken", message: "Name already exists." } })
      }
      return reply.status(404).send({ error: { code: "not_found", message: "Preset not found." } })
    }
    return reply.send({ data: toCamel(row as Row) })
  })

  // DELETE
  app.delete("/v1/node-presets/:id", async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    const id = (req.params as { id: string }).id
    const { error } = await supabase.from("node_presets").delete().eq("id", id).eq("user_id", userId)
    if (error) return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    return reply.send({ data: { success: true } })
  })

  // IMPORT (bulk insert with name-collision suffixing)
  app.post("/v1/node-presets/import", async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    const parsed = importBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid body" } })
    }

    // Load existing (type,name) to avoid unique-violation churn on import.
    const { data: existing } = await supabase.from("node_presets").select("node_type,name").eq("user_id", userId)
    const taken = new Set(
      ((existing ?? []) as { node_type: string; name: string }[]).map((r) => `${r.node_type}::${r.name.toLowerCase()}`),
    )

    const rows = parsed.data.presets
      // Skip presets that carry no portable config after stripping (useless empty rows).
      .map((p) => ({ ...p, data: extractPresetData(p.data) }))
      .filter((p) => Object.keys(p.data).length > 0)
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
        }
      })

    if (rows.length === 0) return reply.send({ data: { imported: 0 } })
    const { error } = await supabase.from("node_presets").insert(rows)
    if (error) return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    return reply.send({ data: { imported: rows.length } })
  })

  // REORDER — bulk-apply positions (and preset group membership) after a drag in the Manage dialog.
  // Every update is scoped by user_id, so foreign ids silently no-op.
  app.post("/v1/node-presets/reorder", async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    const parsed = reorderBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid body" } })
    }
    // A preset may only be moved into one of the caller's own groups.
    const targetGroupIds = (parsed.data.presets ?? [])
      .map((p) => p.groupId)
      .filter((g): g is string => typeof g === "string")
    if ((await unownedGroupIds(userId, targetGroupIds)).length > 0) {
      return reply.status(400).send({ error: { code: "invalid_group", message: "Group not found." } })
    }
    const now = new Date().toISOString()
    const ops: Promise<{ error: unknown }>[] = []
    for (const g of parsed.data.groups ?? []) {
      ops.push(
        (async () => {
          const { error } = await supabase
            .from("node_preset_groups")
            .update({ sort_order: g.sortOrder, updated_at: now })
            .eq("id", g.id)
            .eq("user_id", userId)
          return { error }
        })(),
      )
    }
    for (const p of parsed.data.presets ?? []) {
      const upd: Record<string, unknown> = { sort_order: p.sortOrder, updated_at: now }
      if (p.groupId !== undefined) upd.group_id = p.groupId
      ops.push(
        (async () => {
          const { error } = await supabase
            .from("node_presets")
            .update(upd)
            .eq("id", p.id)
            .eq("user_id", userId)
          return { error }
        })(),
      )
    }
    const results = await Promise.all(ops)
    if (results.some((r) => r.error)) {
      return reply.status(500).send({ error: { code: "internal_error", message: "Reorder failed" } })
    }
    return reply.send({ data: { ok: true } })
  })
}
