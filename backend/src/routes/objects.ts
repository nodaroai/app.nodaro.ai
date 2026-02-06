import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"

const upsertObjectBody = z.object({
  id: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  nodeId: z.string().min(1),
  workflowId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.string().max(50).optional(),
  style: z.string().max(50).optional(),
  sourceImageUrl: z.string().url().optional(),
  angles: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  materials: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  variations: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
})

const deleteObjectParams = z.object({
  id: z.string().min(1),
})

const listObjectsQuery = z.object({
  projectId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
})

export async function objectRoutes(app: FastifyInstance) {
  // List objects for a project
  app.get("/v1/objects", async (req, reply) => {
    const parsed = listObjectsQuery.safeParse(req.query)
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
      .from("objects")
      .select("id, user_id, node_id, project_id, name, description, category, style, source_image_url, angles, materials, variations, created_at, updated_at")
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
    const objects = (data ?? []).map((o) => ({
      id: o.id,
      userId: o.user_id,
      nodeId: o.node_id,
      projectId: o.project_id,
      name: o.name,
      description: o.description,
      category: o.category,
      style: o.style,
      sourceImageUrl: o.source_image_url,
      angles: o.angles,
      materials: o.materials,
      variations: o.variations,
      createdAt: o.created_at,
      updatedAt: o.updated_at,
    }))

    return { objects }
  })

  // Get single object by ID
  app.get("/v1/objects/:id", async (req, reply) => {
    const parsed = deleteObjectParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid object ID",
        },
      })
    }

    const { id } = parsed.data

    const { data, error } = await supabase
      .from("objects")
      .select("id, user_id, node_id, project_id, name, description, category, style, source_image_url, angles, materials, variations, created_at, updated_at")
      .eq("id", id)
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        return reply.status(404).send({
          error: { code: "not_found", message: "Object not found" },
        })
      }
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    // Transform snake_case to camelCase for frontend
    return {
      id: data.id,
      userId: data.user_id,
      nodeId: data.node_id,
      projectId: data.project_id,
      name: data.name,
      description: data.description,
      category: data.category,
      style: data.style,
      sourceImageUrl: data.source_image_url,
      angles: data.angles,
      materials: data.materials,
      variations: data.variations,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    }
  })

  // Upsert object (create or update)
  app.post("/v1/objects", async (req, reply) => {
    const parsed = upsertObjectBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { id, userId, nodeId, workflowId, projectId, name, description, category, style, sourceImageUrl, angles, materials, variations } = parsed.data

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
      category: category ?? null,
      style: style ?? null,
      source_image_url: sourceImageUrl ?? null,
      angles: angles ?? [],
      materials: materials ?? [],
      variations: variations ?? [],
      updated_at: new Date().toISOString(),
    }

    if (id) {
      // Update existing
      const { data: updated, error } = await supabase
        .from("objects")
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
      .from("objects")
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

  // Delete object permanently
  app.delete("/v1/objects/:id", async (req, reply) => {
    const parsed = deleteObjectParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid object ID",
        },
      })
    }

    const { id } = parsed.data

    const { error } = await supabase
      .from("objects")
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
