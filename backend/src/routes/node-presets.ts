import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import { extractPresetData } from "@nodaro/shared"
import { supabase } from "../lib/supabase.js"

const MAX_DATA_BYTES = 64 * 1024

const presetDataSchema = z
  .record(z.string(), z.unknown())
  .refine((d) => JSON.stringify(d).length <= MAX_DATA_BYTES, { message: "preset data too large" })

const createBody = z.object({
  nodeType: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  data: presetDataSchema,
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
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function unauthorized(reply: FastifyReply) {
  return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
}

export async function nodePresetRoutes(app: FastifyInstance) {
  // LIST
  app.get("/v1/node-presets", async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    const nodeType = (req.query as { nodeType?: string }).nodeType
    let q = supabase.from("node_presets").select("*").eq("user_id", userId)
    if (nodeType) q = q.eq("node_type", nodeType)
    const { data, error } = await q.order("created_at", { ascending: false })
    if (error) return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    return reply.send({ data: ((data ?? []) as Row[]).map(toCamel) })
  })

  // CREATE
  app.post("/v1/node-presets", async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    const parsed = createBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid body" } })
    }
    const { nodeType, name, description, data } = parsed.data
    const { data: row, error } = await supabase
      .from("node_presets")
      .insert({
        user_id: userId,
        node_type: nodeType,
        name,
        description: description ?? null,
        data: extractPresetData(data), // defensive strip
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
}
