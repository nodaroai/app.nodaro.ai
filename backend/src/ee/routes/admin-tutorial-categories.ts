// Admin CRUD for the shared tutorial taxonomy (used by both Video Tutorials
// and Flow Tutorials). Lives in EE — only admins can manage the taxonomy.
//
// DELETE rejects with 409 when any tutorial OR workflow_template still
// references the category, so the FK never goes dangling at the DB level.

import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"

const slugSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be kebab-case (lowercase, hyphens)")

const createBody = z.object({
  name: z.string().min(1).max(100),
  slug: slugSchema,
  description: z.string().max(500).optional(),
  sort_order: z.number().int().default(0),
  is_enabled: z.boolean().default(true),
})

const updateBody = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: slugSchema.optional(),
  description: z.string().max(500).nullable().optional(),
  sort_order: z.number().int().optional(),
  is_enabled: z.boolean().optional(),
})

const idParam = z.object({ id: z.string().uuid() })

interface CategoryRow {
  id: string
  name: string
  slug: string
  description: string | null
  sort_order: number
  is_enabled: boolean
  created_at: string
  updated_at: string
}

function toResponse(row: CategoryRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    sortOrder: row.sort_order,
    isEnabled: row.is_enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function adminTutorialCategoriesRoutes(app: FastifyInstance) {
  // GET /v1/admin/tutorial-categories — all categories, enabled or not
  app.get("/v1/admin/tutorial-categories", { preHandler: requireAdmin }, async (_req, reply) => {
    const { data, error } = await supabase
      .from("tutorial_categories")
      .select("*")
      .order("sort_order")

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { data: (data ?? []).map((row) => toResponse(row as CategoryRow)) }
  })

  // POST /v1/admin/tutorial-categories — create
  app.post("/v1/admin/tutorial-categories", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid body",
        },
      })
    }

    const { data, error } = await supabase
      .from("tutorial_categories")
      .insert(parsed.data)
      .select("*")
      .single()

    if (error) {
      if (error.code === "23505") {
        return reply.status(409).send({
          error: { code: "duplicate", message: "A category with this name or slug already exists" },
        })
      }
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { data: toResponse(data as CategoryRow) }
  })

  // PATCH /v1/admin/tutorial-categories/:id — sparse update
  app.patch("/v1/admin/tutorial-categories/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const paramResult = idParam.safeParse(req.params)
    if (!paramResult.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid category ID" },
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
      .from("tutorial_categories")
      .update(updates)
      .eq("id", paramResult.data.id)
      .select("*")
      .maybeSingle()

    if (error) {
      if (error.code === "23505") {
        return reply.status(409).send({
          error: { code: "duplicate", message: "A category with this name or slug already exists" },
        })
      }
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    if (!data) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Category not found" },
      })
    }

    return { data: toResponse(data as CategoryRow) }
  })

  // DELETE /v1/admin/tutorial-categories/:id — reject if anything still references it.
  app.delete("/v1/admin/tutorial-categories/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const paramResult = idParam.safeParse(req.params)
    if (!paramResult.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid category ID" },
      })
    }

    const categoryId = paramResult.data.id

    const [videoUsage, flowUsage] = await Promise.all([
      supabase
        .from("tutorials")
        .select("id", { count: "exact", head: true })
        .eq("category_id", categoryId),
      supabase
        .from("workflow_templates")
        .select("id", { count: "exact", head: true })
        .eq("tutorial_category_id", categoryId),
    ])

    if (videoUsage.error) {
      return reply.status(500).send({ error: { code: "internal_error", message: videoUsage.error.message } })
    }
    if (flowUsage.error) {
      return reply.status(500).send({ error: { code: "internal_error", message: flowUsage.error.message } })
    }

    const videoCount = videoUsage.count ?? 0
    const flowCount = flowUsage.count ?? 0
    if (videoCount > 0 || flowCount > 0) {
      return reply.status(409).send({
        error: {
          code: "category_in_use",
          message: `Cannot delete category: ${videoCount} video tutorial(s) and ${flowCount} flow tutorial(s) still reference it`,
          videoCount,
          flowCount,
        },
      })
    }

    const { error } = await supabase
      .from("tutorial_categories")
      .delete()
      .eq("id", categoryId)

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { success: true }
  })
}
