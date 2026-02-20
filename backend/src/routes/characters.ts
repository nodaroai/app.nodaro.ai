import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"

const upsertCharacterBody = z.object({
  id: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  nodeId: z.string().min(1),
  workflowId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  gender: z.string().max(50).optional(),
  style: z.string().max(50).optional(),
  baseOutfit: z.string().max(1000).optional(),
  sourceImageUrl: safeUrlSchema.optional(),
  expressions: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  poses: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  lightingVariations: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
})

const deleteCharacterParams = z.object({
  id: z.string().min(1),
})

const listCharactersQuery = z.object({
  projectId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
})

export async function characterRoutes(app: FastifyInstance) {
  // List characters for a project
  app.get("/v1/characters", async (req, reply) => {
    const parsed = listCharactersQuery.safeParse(req.query)
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
      .from("characters")
      .select("id, user_id, node_id, project_id, name, description, gender, style, base_outfit, source_image_url, expressions, poses, lighting_variations, created_at, updated_at")
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
    const characters = (data ?? []).map((c) => ({
      id: c.id,
      userId: c.user_id,
      nodeId: c.node_id,
      projectId: c.project_id,
      name: c.name,
      description: c.description,
      gender: c.gender,
      style: c.style,
      baseOutfit: c.base_outfit,
      sourceImageUrl: c.source_image_url,
      expressions: c.expressions,
      poses: c.poses,
      lightingVariations: c.lighting_variations,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    }))

    return { characters }
  })

  // Get single character by ID
  app.get("/v1/characters/:id", async (req, reply) => {
    const parsed = deleteCharacterParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid character ID",
        },
      })
    }

    const { id } = parsed.data

    const { data, error } = await supabase
      .from("characters")
      .select("id, user_id, node_id, project_id, name, description, gender, style, base_outfit, source_image_url, expressions, poses, lighting_variations, created_at, updated_at")
      .eq("id", id)
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        return reply.status(404).send({
          error: { code: "not_found", message: "Character not found" },
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
      gender: data.gender,
      style: data.style,
      baseOutfit: data.base_outfit,
      sourceImageUrl: data.source_image_url,
      expressions: data.expressions,
      poses: data.poses,
      lightingVariations: data.lighting_variations,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    }
  })

  // Upsert character (create or update)
  app.post("/v1/characters", async (req, reply) => {
    const parsed = upsertCharacterBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { id, userId, nodeId, workflowId, projectId, name, description, gender, style, baseOutfit, sourceImageUrl, expressions, poses, lightingVariations } = parsed.data

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
      gender: gender ?? null,
      style: style ?? null,
      base_outfit: baseOutfit ?? null,
      source_image_url: sourceImageUrl ?? null,
      expressions: expressions ?? [],
      poses: poses ?? [],
      lighting_variations: lightingVariations ?? [],
      updated_at: new Date().toISOString(),
    }

    if (id) {
      // Update existing
      const { data: updated, error } = await supabase
        .from("characters")
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
      .from("characters")
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

  // Delete character permanently
  app.delete("/v1/characters/:id", async (req, reply) => {
    const parsed = deleteCharacterParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid character ID",
        },
      })
    }

    const { id } = parsed.data

    const { error } = await supabase
      .from("characters")
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
