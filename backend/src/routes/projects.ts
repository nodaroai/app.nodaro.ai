import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"

const projectIdParams = z.object({
  id: z.string().uuid(),
})

const createProjectBody = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(2000).optional(),
  settings: z.record(z.unknown()).optional(),
})

const updateProjectBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    settings: z.record(z.unknown()).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  })

const PROJECT_COLS =
  "id, user_id, name, description, settings, created_at, updated_at"

function toProjectResponse(row: Record<string, unknown>) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    settings: row.settings,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function projectRoutes(app: FastifyInstance) {
  // List projects for authenticated user
  app.get("/v1/projects", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const { data, error } = await supabase
      .from("projects")
      .select(PROJECT_COLS)
      .eq("user_id", req.userId)
      .order("created_at", { ascending: false })

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { data: (data ?? []).map(toProjectResponse) }
  })

  // Create project
  app.post("/v1/projects", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = createProjectBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { name, description, settings } = parsed.data

    const { data, error } = await supabase
      .from("projects")
      .insert({
        user_id: req.userId,
        name,
        description: description ?? null,
        settings: settings ?? {},
      })
      .select(PROJECT_COLS)
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return reply.status(201).send({ data: toProjectResponse(data) })
  })

  // Get project by ID
  app.get("/v1/projects/:id", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = projectIdParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid project ID",
        },
      })
    }

    const { id } = parsed.data

    const { data, error } = await supabase
      .from("projects")
      .select(PROJECT_COLS)
      .eq("id", id)
      .eq("user_id", req.userId)
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        return reply.status(404).send({
          error: { code: "not_found", message: "Project not found" },
        })
      }
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { data: toProjectResponse(data) }
  })

  // Update project
  app.patch("/v1/projects/:id", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const paramsParsed = projectIdParams.safeParse(req.params)
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message:
            paramsParsed.error.issues[0]?.message ?? "Invalid project ID",
        },
      })
    }

    const bodyParsed = updateProjectBody.safeParse(req.body)
    if (!bodyParsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: bodyParsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { id } = paramsParsed.data
    const { name, description, settings } = bodyParsed.data

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name !== undefined) updates.name = name
    if (description !== undefined) updates.description = description
    if (settings !== undefined) updates.settings = settings

    const { data, error } = await supabase
      .from("projects")
      .update(updates)
      .eq("id", id)
      .eq("user_id", req.userId)
      .select(PROJECT_COLS)
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        return reply.status(404).send({
          error: { code: "not_found", message: "Project not found" },
        })
      }
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { data: toProjectResponse(data) }
  })

  // Delete project
  app.delete("/v1/projects/:id", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = projectIdParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid project ID",
        },
      })
    }

    const { id } = parsed.data

    const { error } = await supabase
      .from("projects")
      .delete()
      .eq("id", id)
      .eq("user_id", req.userId)

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { success: true }
  })
}
