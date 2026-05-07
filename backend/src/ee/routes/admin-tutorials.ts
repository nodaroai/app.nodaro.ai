import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { toTutorialResponse } from "../../lib/tutorials-shared.js"

const createBody = z.object({
  title: z.string().min(1),
  video_url: z.string().url(),
  description: z.string().optional(),
  thumbnail_url: z.string().url().optional(),
  category: z.string().min(1).default("getting-started"),
  sort_order: z.number().int().default(0),
  is_enabled: z.boolean().default(true),
})

const updateBody = z.object({
  title: z.string().min(1).optional(),
  video_url: z.string().url().optional(),
  description: z.string().nullable().optional(),
  thumbnail_url: z.string().url().nullable().optional(),
  category: z.string().min(1).optional(),
  sort_order: z.number().int().optional(),
  is_enabled: z.boolean().optional(),
})

const idParam = z.object({ id: z.string().uuid() })

export async function adminTutorialsRoutes(app: FastifyInstance) {
  // GET /v1/admin/tutorials — all tutorials including disabled
  app.get("/v1/admin/tutorials", { preHandler: requireAdmin }, async (_req, reply) => {
    const { data, error } = await supabase
      .from("tutorials")
      .select("*")
      .order("sort_order")

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { data: (data ?? []).map(toTutorialResponse) }
  })

  // POST /v1/admin/tutorials — create tutorial
  app.post("/v1/admin/tutorials", { preHandler: requireAdmin }, async (req, reply) => {
    const result = createBody.safeParse(req.body)
    if (!result.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: result.error.issues[0]?.message ?? "Invalid body",
        },
      })
    }

    const { data, error } = await supabase
      .from("tutorials")
      .insert(result.data)
      .select("*")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { data: toTutorialResponse(data) }
  })

  // PATCH /v1/admin/tutorials/:id — sparse update
  app.patch("/v1/admin/tutorials/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const paramResult = idParam.safeParse(req.params)
    if (!paramResult.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid tutorial ID" },
      })
    }

    const bodyResult = updateBody.safeParse(req.body)
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: bodyResult.error.issues[0]?.message ?? "Invalid body",
        },
      })
    }

    const updates = bodyResult.data
    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "No fields to update" },
      })
    }

    const { data, error } = await supabase
      .from("tutorials")
      .update(updates)
      .eq("id", paramResult.data.id)
      .select("*")
      .maybeSingle()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    if (!data) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Tutorial not found" },
      })
    }

    return { data: toTutorialResponse(data) }
  })

  // DELETE /v1/admin/tutorials/:id — remove tutorial
  app.delete("/v1/admin/tutorials/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const paramResult = idParam.safeParse(req.params)
    if (!paramResult.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid tutorial ID" },
      })
    }

    const { error } = await supabase
      .from("tutorials")
      .delete()
      .eq("id", paramResult.data.id)

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { success: true }
  })
}
