import type { FastifyInstance } from "fastify"
import { randomBytes } from "node:crypto"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { rateLimiter } from "../middleware/rate-limit.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { surfaceAllowsPublicOutputs } from "../lib/surface-profile.js"

/**
 * Cine shots — the Share → Remix record (spec: backend-share-remix.md).
 *
 * POST   /v1/shots      (auth)   create; returns { id }.
 * GET    /v1/shots/:id  (PUBLIC) read for the share page / remix hydration.
 *                                The id is the capability; private shots are
 *                                visible to their owner only and 404 (not 403)
 *                                to everyone else — existence is not leaked.
 * PATCH  /v1/shots/:id  (owner)  update (incl. visibility toggle — sharing is
 *                                an explicit "make shareable" action; rows
 *                                default to private).
 * DELETE /v1/shots/:id  (owner)  delete.
 *
 * Tenant scoping: every owner operation filters `.eq("owner_id", userId)`
 * in-handler; the public GET is cross-user BY DESIGN (allow-listed in the
 * admin-client lint alongside gallery/presentation).
 */

/** Only http(s) URLs may be stored as results — and never signed URLs (their
 *  query would leak a token into a public record). */
const publicUrl = z
  .string()
  .url()
  .max(2048)
  .refine((u) => /^https?:\/\//.test(u), "must be http(s)")
  .refine((u) => !/[?&](x-amz-|token=|signature=|sig=)/i.test(u), "signed URLs cannot be shared")

const shotBody = z.object({
  mode: z.enum(["single", "multi-shot", "frame-to-motion", "storyboard"]).default("single"),
  selectionState: z.record(z.string(), z.unknown()).default({}),
  freeText: z.string().max(30000).optional(),
  negativePrompt: z.string().max(4000).optional(),
  assembledPrompt: z.string().max(60000).optional(),
  perModelPrompts: z.record(z.string(), z.string().max(60000)).optional(),
  models: z.array(z.string().max(100)).max(16).optional(),
  entityRefs: z
    .array(
      z.object({
        entitySlug: z.string().max(200),
        variantSlug: z.string().max(200).optional(),
        role: z.string().max(100).optional(),
        kind: z.enum(["character", "location", "object", "creature"]).optional(),
      }),
    )
    .max(32)
    .optional(),
  resultUrls: z.array(publicUrl).max(32).optional(),
  visibility: z.enum(["private", "public"]).default("private"),
})

const shotPatchBody = shotBody.partial()

/** Short, URL-safe, unguessable id (12 chars base64url ≈ 72 bits). */
export function newShotId(): string {
  return randomBytes(9).toString("base64url")
}

/** DB row → wire shape (camelCase). Exported for tests. */
export function toWire(row: Record<string, unknown>) {
  return {
    id: row.id,
    mode: row.mode,
    selectionState: row.selection_state ?? {},
    freeText: row.free_text ?? undefined,
    negativePrompt: row.negative_prompt ?? undefined,
    assembledPrompt: row.assembled_prompt ?? undefined,
    perModelPrompts: row.per_model_prompts ?? undefined,
    models: row.models ?? undefined,
    entityRefs: row.entity_refs ?? undefined,
    resultUrls: row.result_urls ?? undefined,
    visibility: row.visibility,
    schemaVersion: row.schema_version,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toRow(body: z.infer<typeof shotPatchBody>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (body.mode !== undefined) row.mode = body.mode
  if (body.selectionState !== undefined) row.selection_state = body.selectionState
  if (body.freeText !== undefined) row.free_text = body.freeText
  if (body.negativePrompt !== undefined) row.negative_prompt = body.negativePrompt
  if (body.assembledPrompt !== undefined) row.assembled_prompt = body.assembledPrompt
  if (body.perModelPrompts !== undefined) row.per_model_prompts = body.perModelPrompts
  if (body.models !== undefined) row.models = body.models
  if (body.entityRefs !== undefined) row.entity_refs = body.entityRefs
  if (body.resultUrls !== undefined) row.result_urls = body.resultUrls
  if (body.visibility !== undefined) row.visibility = body.visibility
  return row
}

const NOT_FOUND = { error: { code: "not_found", message: "Shot not found" } }

export async function shotsRoutes(app: FastifyInstance) {
  // Public read is the abuse surface — cap per IP.
  const readLimit = rateLimiter({ windowMs: 60_000, max: 60, keyPrefix: "shots-read" })

  app.post("/v1/shots", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    const parsed = shotBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    const id = newShotId()
    const { error } = await supabase
      .from("cine_shots")
      .insert({ id, owner_id: userId, ...toRow(parsed.data) })
    if (error) {
      return sendInternalError(reply, req, error, "Failed to create shot")
    }
    return reply.status(201).send({ id })
  })

  app.get("/v1/shots/:id", { preHandler: readLimit }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!id || id.length > 64) return reply.status(404).send(NOT_FOUND)
    const { data, error } = await supabase.from("cine_shots").select("*").eq("id", id).maybeSingle()
    if (error) {
      return sendInternalError(reply, req, error, "Failed to load shot")
    }
    // Private shots exist only for their owner — 404 either way (the id is
    // the capability; existence of a private shot is not leaked). On a
    // deployment that does not allow public work (`outputs.allowPublic:
    // false`) every shot reads as private: a link shared before the switch
    // was set answers everyone but its signed-in owner as a private shot does.
    const sharedPublicly = data?.visibility === "public" && surfaceAllowsPublicOutputs()
    if (!data || (!sharedPublicly && data.owner_id !== req.userId)) {
      return reply.status(404).send(NOT_FOUND)
    }
    return reply.send({ shot: toWire(data) })
  })

  app.patch("/v1/shots/:id", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    const { id } = req.params as { id: string }
    const parsed = shotPatchBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    const row = toRow(parsed.data)
    if (Object.keys(row).length === 0) {
      return reply.status(400).send({ error: { code: "validation_error", message: "No fields to update" } })
    }
    row.updated_at = new Date().toISOString()
    const { data, error } = await supabase
      .from("cine_shots")
      .update(row)
      .eq("id", id)
      .eq("owner_id", userId)
      .select("*")
      .maybeSingle()
    if (error) {
      return sendInternalError(reply, req, error, "Failed to update shot")
    }
    if (!data) return reply.status(404).send(NOT_FOUND)
    return reply.send({ shot: toWire(data) })
  })

  app.delete("/v1/shots/:id", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    const { id } = req.params as { id: string }
    const { data, error } = await supabase
      .from("cine_shots")
      .delete()
      .eq("id", id)
      .eq("owner_id", userId)
      .select("id")
      .maybeSingle()
    if (error) {
      return sendInternalError(reply, req, error, "Failed to delete shot")
    }
    if (!data) return reply.status(404).send(NOT_FOUND)
    return reply.status(204).send()
  })
}
