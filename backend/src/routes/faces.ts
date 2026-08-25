import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { decodeKeysetCursor, keysetFilter, sliceKeysetPage } from "../lib/keyset-cursor.js"
import { deletedNothing, sendNotFound } from "../lib/scoped-delete.js"

const upsertFaceBody = z.object({
  id: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  nodeId: z.string().min(1),
  workflowId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  style: z.string().max(50).optional(),
  sourceImageUrl: safeUrlSchema.optional(),
  expressions: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
})

const deleteFaceParams = z.object({
  id: z.string().min(1),
})

const listFacesQuery = z.object({
  projectId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  // Opt-IN pagination, the /v1/characters contract — see objects.ts for why
  // there is deliberately NO default. Absent limit = the exact legacy
  // response; present limit = a page plus `nextCursor`.
  limit: z.coerce.number().int().positive().max(500).optional(),
  cursor: z.string().max(512).optional(),
})
  // A cursor is meaningless outside a paginated read — refusing the combo
  // keeps "legacy response" and "page" from ever blending into a filtered
  // unbounded fetch nobody designed.
  .refine((q) => q.cursor === undefined || q.limit !== undefined, {
    message: "cursor requires limit",
  })

export async function faceRoutes(app: FastifyInstance) {
  // List faces for a user (optionally filter by project)
  app.get("/v1/faces", async (req, reply) => {
    const parsed = listFacesQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid query",
        },
      })
    }

    const { projectId, limit, cursor: rawCursor } = parsed.data
    const userId = req.userId

    // An undecodable cursor is a 400, NOT a silent fall-through to page 1.
    const cursor = rawCursor ? decodeKeysetCursor(rawCursor) : null
    if (rawCursor && !cursor) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid cursor" },
      })
    }

    let query = supabase
      .from("faces")
      .select("id, user_id, node_id, project_id, name, description, style, source_image_url, expressions, created_at, updated_at")
      .order("created_at", { ascending: false })
      // The tie-break that makes the ordering total.
      .order("id", { ascending: false })

    if (projectId) {
      query = query.eq("project_id", projectId)
    }
    if (userId) {
      query = query.eq("user_id", userId)
    }
    if (cursor) query = query.or(keysetFilter(cursor))
    if (limit !== undefined) query = query.limit(limit + 1)

    const { data, error } = await query

    if (error) {
      return sendInternalError(reply, req, error, "Failed to fetch faces")
    }

    // Transform snake_case to camelCase for frontend
    const toCamel = (f: NonNullable<typeof data>[number]) => ({
      id: f.id,
      userId: f.user_id,
      nodeId: f.node_id,
      projectId: f.project_id,
      name: f.name,
      description: f.description,
      style: f.style,
      sourceImageUrl: f.source_image_url,
      expressions: f.expressions,
      createdAt: f.created_at,
      updatedAt: f.updated_at,
    })

    // Legacy callers (no `limit`) get the exact response they always did —
    // no `nextCursor` field. Paginated callers get the page and the cursor.
    if (limit === undefined) {
      return { faces: (data ?? []).map(toCamel) }
    }
    const { page, nextCursor } = sliceKeysetPage(data ?? [], limit)
    return { faces: page.map(toCamel), nextCursor }
  })

  // Get single face by ID
  app.get("/v1/faces/:id", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = deleteFaceParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid face ID",
        },
      })
    }

    const { id } = parsed.data

    const { data, error } = await supabase
      .from("faces")
      .select("id, user_id, node_id, project_id, name, description, style, source_image_url, expressions, created_at, updated_at")
      .eq("id", id)
      .eq("user_id", userId)
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        return reply.status(404).send({
          error: { code: "not_found", message: "Face not found" },
        })
      }
      return sendInternalError(reply, req, error, "Failed to fetch face")
    }

    return {
      id: data.id,
      userId: data.user_id,
      nodeId: data.node_id,
      projectId: data.project_id,
      name: data.name,
      description: data.description,
      style: data.style,
      sourceImageUrl: data.source_image_url,
      expressions: data.expressions,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    }
  })

  // Upsert face (create or update)
  app.post("/v1/faces", async (req, reply) => {
    const parsed = upsertFaceBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { id, nodeId, workflowId, projectId, name, description, style, sourceImageUrl, expressions } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const row = {
      user_id: userId,
      node_id: nodeId,
      workflow_id: workflowId ?? null,
      project_id: projectId ?? null,
      name,
      description: description ?? null,
      style: style ?? null,
      source_image_url: sourceImageUrl ?? null,
      expressions: expressions ?? [],
      updated_at: new Date().toISOString(),
    }

    if (id) {
      // Update existing. Scope by user_id so a caller cannot overwrite another
      // user's row by passing their id (the update would otherwise rewrite
      // user_id to the caller, silently stealing the record).
      const { data: updated, error } = await supabase
        .from("faces")
        .update(row)
        .eq("id", id)
        .eq("user_id", userId)
        .select("id")
        .single()

      if (error) {
        return sendInternalError(reply, req, error, "Failed to update face")
      }
      return { id: updated.id }
    }

    // Insert new
    const { data: created, error } = await supabase
      .from("faces")
      .insert(row)
      .select("id")
      .single()

    if (error) {
      return sendInternalError(reply, req, error, "Failed to save face")
    }

    return { id: created.id }
  })

  // Delete face permanently
  app.delete("/v1/faces/:id", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = deleteFaceParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid face ID",
        },
      })
    }

    const { id } = parsed.data

    const { data, error } = await supabase
      .from("faces")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .select("id")

    if (error) {
      return sendInternalError(reply, req, error, "Failed to delete face")
    }
    if (deletedNothing(data)) return sendNotFound(reply, "Face not found")

    return { success: true }
  })
}
