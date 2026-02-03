import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"

const upsertLocationBody = z.object({
  id: z.string().uuid().optional(),
  nodeId: z.string().min(1),
  workflowId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.string().max(50).optional(),
  style: z.string().max(50).optional(),
  sourceImageUrl: z.string().url().optional(),
  timeOfDay: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  weather: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  angles: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
})

const deleteLocationParams = z.object({
  id: z.string().uuid(),
})

const listLocationsQuery = z.object({
  projectId: z.string().uuid().optional(),
})

export async function locationRoutes(app: FastifyInstance) {
  // List locations for a project
  app.get("/v1/locations", async (req, reply) => {
    const parsed = listLocationsQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid query",
        },
      })
    }

    const { projectId } = parsed.data

    let query = supabase
      .from("locations")
      .select("id, node_id, project_id, name, description, category, style, source_image_url, time_of_day, weather, angles, created_at, updated_at")
      .order("created_at", { ascending: false })

    if (projectId) {
      query = query.eq("project_id", projectId)
    }

    const { data, error } = await query

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    // Transform snake_case to camelCase for frontend
    const locations = (data ?? []).map((loc) => ({
      id: loc.id,
      nodeId: loc.node_id,
      projectId: loc.project_id,
      name: loc.name,
      description: loc.description,
      category: loc.category,
      style: loc.style,
      sourceImageUrl: loc.source_image_url,
      timeOfDay: loc.time_of_day,
      weather: loc.weather,
      angles: loc.angles,
      createdAt: loc.created_at,
      updatedAt: loc.updated_at,
    }))

    return { locations }
  })

  // Upsert location (create or update)
  app.post("/v1/locations", async (req, reply) => {
    const parsed = upsertLocationBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { id, nodeId, workflowId, projectId, name, description, category, style, sourceImageUrl, timeOfDay, weather, angles } = parsed.data

    const row = {
      node_id: nodeId,
      workflow_id: workflowId ?? null,
      project_id: projectId ?? null,
      name,
      description: description ?? null,
      category: category ?? null,
      style: style ?? null,
      source_image_url: sourceImageUrl ?? null,
      time_of_day: timeOfDay ?? [],
      weather: weather ?? [],
      angles: angles ?? [],
      updated_at: new Date().toISOString(),
    }

    if (id) {
      // Update existing
      const { data: updated, error } = await supabase
        .from("locations")
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
      .from("locations")
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

  // Delete location permanently
  app.delete("/v1/locations/:id", async (req, reply) => {
    const parsed = deleteLocationParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid location ID",
        },
      })
    }

    const { id } = parsed.data

    const { error } = await supabase
      .from("locations")
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
