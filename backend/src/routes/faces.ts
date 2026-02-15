import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"

const upsertFaceBody = z.object({
  id: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  nodeId: z.string().min(1),
  workflowId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  style: z.string().max(50).optional(),
  sourceImageUrl: z.string().url().optional(),
  expressions: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
})

const deleteFaceParams = z.object({
  id: z.string().min(1),
})

const listFacesQuery = z.object({
  projectId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
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

    const { projectId, userId } = parsed.data

    let query = supabase
      .from("faces")
      .select("id, user_id, node_id, project_id, name, description, style, source_image_url, expressions, created_at, updated_at")
      .order("created_at", { ascending: false })

    if (projectId) {
      query = query.eq("project_id", projectId)
    }
    if (userId) {
      query = query.eq("user_id", userId)
    }

    const { data, error } = await query

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    // Transform snake_case to camelCase for frontend
    const faces = (data ?? []).map((f) => ({
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
    }))

    return { faces }
  })

  // Get single face by ID
  app.get("/v1/faces/:id", async (req, reply) => {
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
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        return reply.status(404).send({
          error: { code: "not_found", message: "Face not found" },
        })
      }
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
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
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { id, userId, nodeId, workflowId, projectId, name, description, style, sourceImageUrl, expressions } = parsed.data

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "userId is required" },
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
      // Update existing
      const { data: updated, error } = await supabase
        .from("faces")
        .update(row)
        .eq("id", id)
        .select("id")
        .single()

      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
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
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { id: created.id }
  })

  // Delete face permanently
  app.delete("/v1/faces/:id", async (req, reply) => {
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

    const { error } = await supabase
      .from("faces")
      .delete()
      .eq("id", id)

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { success: true }
  })
}
