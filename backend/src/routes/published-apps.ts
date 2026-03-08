import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { estimateWorkflowCredits } from "../billing/credits.js"
import { invalidateAppCache } from "./app-runner.js"

function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
  const suffix = Math.random().toString(36).slice(2, 8)
  return `${base}-${suffix}`
}

function toCamelCase(row: Record<string, unknown>) {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    creatorId: row.creator_id,
    version: row.version,
    slug: row.slug,
    name: row.name,
    description: row.description,
    iconUrl: row.icon_url,
    snapshotNodes: row.snapshot_nodes,
    snapshotEdges: row.snapshot_edges,
    snapshotSettings: row.snapshot_settings,
    isActive: row.is_active,
    isListed: row.is_listed,
    isEmbeddable: row.is_embeddable,
    allowedOrigins: row.allowed_origins,
    estimatedCredits: row.estimated_credits,
    thumbnailNodeId: row.thumbnail_node_id ?? null,
    createdAt: row.created_at,
  }
}

const publishBodySchema = z.object({
  workflowId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  slug: z.string().min(1).max(50).optional(),
  iconUrl: z.string().url().optional(),
  thumbnailNodeId: z.string().max(100).nullable().optional(),
})

const updateBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  isActive: z.boolean().optional(),
  isListed: z.boolean().optional(),
  isEmbeddable: z.boolean().optional(),
  allowedOrigins: z.array(z.string()).optional(),
  maxRunsPerUserPerDay: z.number().int().min(0).optional(),
  thumbnailNodeId: z.string().max(100).nullable().optional(),
})

export async function publishedAppsRoutes(app: FastifyInstance) {
  // POST /v1/apps/publish — Publish a workflow as an app
  app.post("/v1/apps/publish", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })

    const parsed = publishBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    const { workflowId, name, description, slug: providedSlug, iconUrl, thumbnailNodeId } = parsed.data

    // Verify user owns the workflow
    const { data: workflow, error: wfError } = await supabase
      .from("workflows")
      .select("id, user_id, nodes, edges, settings")
      .eq("id", workflowId)
      .single()

    if (wfError || !workflow) {
      return reply.status(404).send({ error: { code: "not_found", message: "Workflow not found" } })
    }
    if (workflow.user_id !== userId) {
      return reply.status(403).send({ error: { code: "forbidden", message: "Not your workflow" } })
    }

    // Compute version
    const { data: existingApps } = await supabase
      .from("published_apps")
      .select("version")
      .eq("workflow_id", workflowId)
      .order("version", { ascending: false })
      .limit(1)

    const version = existingApps && existingApps.length > 0 ? existingApps[0].version + 1 : 1

    // Estimate credits
    const nodes = workflow.nodes || []
    const edges = workflow.edges || []
    const estimatedCredits = estimateWorkflowCredits(nodes as Array<{ type: string }>)

    // Generate slug with collision retry
    const MAX_SLUG_RETRIES = 5
    let publishedApp: Record<string, unknown> | null = null
    let insertError: { code?: string; message?: string } | null = null

    for (let attempt = 0; attempt < MAX_SLUG_RETRIES; attempt++) {
      const slug = providedSlug && attempt === 0
        ? providedSlug
        : generateSlug(name)

      const result = await supabase
        .from("published_apps")
        .insert({
          workflow_id: workflowId,
          creator_id: userId,
          name,
          description: description || null,
          slug,
          icon_url: iconUrl || null,
          version,
          snapshot_nodes: nodes,
          snapshot_edges: edges,
          snapshot_settings: workflow.settings || {},
          estimated_credits: estimatedCredits,
          thumbnail_node_id: thumbnailNodeId ?? null,
        })
        .select()
        .single()

      if (!result.error) {
        publishedApp = result.data
        insertError = null
        break
      }

      // Unique constraint violation — retry with a new slug
      if (result.error.code === "23505" && !providedSlug) {
        insertError = result.error
        continue
      }

      // User-provided slug collision — don't retry
      if (result.error.code === "23505" && providedSlug) {
        return reply.status(409).send({ error: { code: "conflict", message: "Slug already taken" } })
      }

      insertError = result.error
      break
    }

    if (insertError || !publishedApp) {
      return reply.status(500).send({ error: { code: "internal_error", message: "Failed to publish app" } })
    }

    // Invalidate app cache for this slug
    const publishedSlug = publishedApp.slug as string
    if (publishedSlug) invalidateAppCache(publishedSlug)

    // Update workflow with published_app_id
    await supabase
      .from("workflows")
      .update({ published_app_id: publishedApp.id })
      .eq("id", workflowId)

    return reply.send(toCamelCase(publishedApp))
  })

  // GET /v1/apps/mine — List creator's published apps
  app.get("/v1/apps/mine", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })

    const { data: apps, error } = await supabase
      .from("published_apps")
      .select("*, app_runs(count)")
      .eq("creator_id", userId)
      .order("created_at", { ascending: false })

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: "Failed to fetch apps" } })
    }

    // Transform to camelCase + flatten count
    const result = (apps || []).map((app: any) => ({
      id: app.id,
      workflowId: app.workflow_id,
      creatorId: app.creator_id,
      version: app.version,
      slug: app.slug,
      name: app.name,
      description: app.description,
      iconUrl: app.icon_url,
      isActive: app.is_active,
      isListed: app.is_listed,
      isEmbeddable: app.is_embeddable,
      allowedOrigins: app.allowed_origins,
      estimatedCredits: app.estimated_credits,
      thumbnailNodeId: app.thumbnail_node_id ?? null,
      createdAt: app.created_at,
      runCount: app.app_runs?.[0]?.count ?? 0,
    }))

    return reply.send(result)
  })

  // PATCH /v1/apps/:appId — Update app metadata
  app.patch("/v1/apps/:appId", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })

    const { appId } = req.params as { appId: string }

    const parsed = updateBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    // Verify ownership
    const { data: existing, error: fetchError } = await supabase
      .from("published_apps")
      .select("id, creator_id")
      .eq("id", appId)
      .single()

    if (fetchError || !existing) {
      return reply.status(404).send({ error: { code: "not_found", message: "App not found" } })
    }
    if (existing.creator_id !== userId) {
      return reply.status(403).send({ error: { code: "forbidden", message: "Not your app" } })
    }

    // Build update object from provided fields
    const updates: Record<string, any> = {}
    const body = parsed.data
    if (body.name !== undefined) updates.name = body.name
    if (body.description !== undefined) updates.description = body.description
    if (body.isActive !== undefined) updates.is_active = body.isActive
    if (body.isListed !== undefined) updates.is_listed = body.isListed
    if (body.isEmbeddable !== undefined) updates.is_embeddable = body.isEmbeddable
    if (body.allowedOrigins !== undefined) updates.allowed_origins = body.allowedOrigins
    if (body.maxRunsPerUserPerDay !== undefined) updates.max_runs_per_user_per_day = body.maxRunsPerUserPerDay
    if (body.thumbnailNodeId !== undefined) updates.thumbnail_node_id = body.thumbnailNodeId

    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ error: { code: "bad_request", message: "No fields to update" } })
    }

    const { data: updated, error: updateError } = await supabase
      .from("published_apps")
      .update(updates)
      .eq("id", appId)
      .select()
      .single()

    if (updateError) {
      return reply.status(500).send({ error: { code: "internal_error", message: "Failed to update app" } })
    }

    return reply.send(toCamelCase(updated as Record<string, unknown>))
  })

  // DELETE /v1/apps/:appId — Soft delete (set is_active = false)
  app.delete("/v1/apps/:appId", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })

    const { appId } = req.params as { appId: string }

    // Verify ownership
    const { data: existing, error: fetchError } = await supabase
      .from("published_apps")
      .select("id, creator_id")
      .eq("id", appId)
      .single()

    if (fetchError || !existing) {
      return reply.status(404).send({ error: { code: "not_found", message: "App not found" } })
    }
    if (existing.creator_id !== userId) {
      return reply.status(403).send({ error: { code: "forbidden", message: "Not your app" } })
    }

    const { error: updateError } = await supabase
      .from("published_apps")
      .update({ is_active: false })
      .eq("id", appId)

    if (updateError) {
      return reply.status(500).send({ error: { code: "internal_error", message: "Failed to deactivate app" } })
    }

    return reply.send({ success: true })
  })
}
