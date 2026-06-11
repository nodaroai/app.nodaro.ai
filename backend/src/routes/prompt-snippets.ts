import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import { FACTORY_SNIPPETS } from "@nodaro/shared"
import { supabase } from "../lib/supabase.js"
import { requireScope } from "../lib/scopes.js"
import { rejectProgrammaticAuth } from "../lib/api-auth-mode.js"

// Snippets are read-only over the API (SDK/CLI/MCP expose reads only); writes
// are editor-only (first-party JWT). Mirrors the node-presets posture.
const SNIPPETS_READ_ONLY_MSG =
  "Prompt snippets are read-only over the API. Create and edit snippets in the editor."

// `{`/`}` would form {Label} variable tokens, `@` would form @slug mentions,
// and newlines break the per-line pill matcher — all rejected at the boundary
// (same invariants the factory-catalog guard test enforces).
const snippetText = z
  .string()
  .min(1)
  .max(2000)
  .refine((t) => !/[{}@\n]/.test(t), {
    message: "Snippet text may not contain {, }, @, or line breaks",
  })
  .refine((t) => t.trim() === t, { message: "Snippet text may not have leading/trailing whitespace" })

const mediaSchema = z.array(z.enum(["image", "video", "audio", "text"])).max(4)

export const snippetCreateBody = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
  text: snippetText,
  target: z.enum(["prompt", "negative"]),
  media: mediaSchema,
  category: z.string().min(1).max(60).optional(),
  sortOrder: z.number().int().optional(),
})

export const snippetPatchBody = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(300).nullable().optional(),
  text: snippetText.optional(),
  target: z.enum(["prompt", "negative"]).optional(),
  media: mediaSchema.optional(),
  category: z.string().min(1).max(60).nullable().optional(),
  sortOrder: z.number().int().optional(),
})

type Row = {
  id: string
  user_id: string
  name: string
  description: string | null
  text: string
  target: "prompt" | "negative"
  media: string[] | null
  category: string | null
  sort_order: number | null
  created_at: string
  updated_at: string
}

function toCamel(r: Row) {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    text: r.text,
    target: r.target,
    media: r.media ?? [],
    category: r.category ?? undefined,
    sortOrder: r.sort_order ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function unauthorized(reply: FastifyReply) {
  return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
}

export async function promptSnippetRoutes(app: FastifyInstance) {
  // LIST (user's custom snippets)
  app.get("/v1/prompt-snippets", async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    if (req.appAuthorization) {
      const err = requireScope(req.appAuthorization.scopes, "presets:read")
      if (err) return reply.status(err.statusCode).send(err.body)
    }
    const { data, error } = await supabase
      .from("prompt_snippets")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
    if (error) return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    return reply.send({ data: ((data ?? []) as Row[]).map(toCamel) })
  })

  // FACTORY catalog (read-only, from @nodaro/shared). Static path before any :id.
  app.get("/v1/prompt-snippets/factory", async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    if (req.appAuthorization) {
      const err = requireScope(req.appAuthorization.scopes, "presets:read")
      if (err) return reply.status(err.statusCode).send(err.body)
    }
    return reply.send({ data: FACTORY_SNIPPETS })
  })

  // CREATE
  app.post("/v1/prompt-snippets", async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    if (rejectProgrammaticAuth(req, reply, SNIPPETS_READ_ONLY_MSG)) return
    const parsed = snippetCreateBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid body" } })
    }
    const { name, description, text, target, media, category, sortOrder } = parsed.data
    const { data: row, error } = await supabase
      .from("prompt_snippets")
      .insert({
        user_id: userId,
        name,
        description: description ?? null,
        text,
        target,
        media,
        category: category ?? null,
        ...(sortOrder !== undefined ? { sort_order: sortOrder } : {}),
      })
      .select("*")
      .single()
    if (error) {
      if (error.code === "23505") {
        return reply.status(409).send({ error: { code: "name_taken", message: "A snippet with that name already exists." } })
      }
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }
    return reply.status(201).send({ data: toCamel(row as Row) })
  })

  // UPDATE
  app.patch("/v1/prompt-snippets/:id", async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    if (rejectProgrammaticAuth(req, reply, SNIPPETS_READ_ONLY_MSG)) return
    const id = (req.params as { id: string }).id
    const parsed = snippetPatchBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid body" } })
    }
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (parsed.data.name !== undefined) updates.name = parsed.data.name
    if (parsed.data.description !== undefined) updates.description = parsed.data.description
    if (parsed.data.text !== undefined) updates.text = parsed.data.text
    if (parsed.data.target !== undefined) updates.target = parsed.data.target
    if (parsed.data.media !== undefined) updates.media = parsed.data.media
    if (parsed.data.category !== undefined) updates.category = parsed.data.category
    if (parsed.data.sortOrder !== undefined) updates.sort_order = parsed.data.sortOrder
    const { data: row, error } = await supabase
      .from("prompt_snippets")
      .update(updates)
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .single()
    if (error) {
      if (error.code === "23505") {
        return reply.status(409).send({ error: { code: "name_taken", message: "Name already exists." } })
      }
      return reply.status(404).send({ error: { code: "not_found", message: "Snippet not found." } })
    }
    return reply.send({ data: toCamel(row as Row) })
  })

  // DELETE
  app.delete("/v1/prompt-snippets/:id", async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    if (rejectProgrammaticAuth(req, reply, SNIPPETS_READ_ONLY_MSG)) return
    const id = (req.params as { id: string }).id
    const { error } = await supabase.from("prompt_snippets").delete().eq("id", id).eq("user_id", userId)
    if (error) return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    return reply.send({ data: { success: true } })
  })
}
