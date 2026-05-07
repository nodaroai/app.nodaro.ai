import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { estimateWorkflowCredits } from "../ee/billing/credits.js"
import { getNodeResult, getOutputType } from "@nodaro/shared"
import { sanitizeSlugBase, generateSlug, getCreatorDisplayName } from "../lib/marketplace-helpers.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = [
  "image-generation", "video-production", "audio-music", "content-writing",
  "social-media", "data-processing", "multi-step", "other",
] as const

const VALID_OUTPUT_TYPES = ["image", "video", "audio", "text"] as const
const VALID_COMPLEXITIES = ["simple", "intermediate", "advanced"] as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract unique node types from a workflow's nodes. */
function extractNodeTypes(nodes: Array<Record<string, unknown>>): string[] {
  const types = new Set<string>()
  for (const node of nodes) {
    if (typeof node.type === "string" && node.type) types.add(node.type)
  }
  return Array.from(types)
}

/** Extract unique non-null provider values from nodes. */
function extractProviders(nodes: Array<Record<string, unknown>>): string[] {
  const providers = new Set<string>()
  for (const node of nodes) {
    const data = node.data as Record<string, unknown> | undefined
    if (data && typeof data.provider === "string" && data.provider) {
      providers.add(data.provider)
    }
  }
  return Array.from(providers)
}

/** Calculate workflow complexity based on node count and branching. */
function calculateComplexity(
  nodes: Array<Record<string, unknown>>,
  edges: Array<Record<string, unknown>>,
): "simple" | "intermediate" | "advanced" {
  const nodeCount = nodes.length

  if (nodeCount >= 16) return "advanced"

  // Check for branching: any node with >1 outgoing edge
  const outgoingCount = new Map<string, number>()
  for (const edge of edges) {
    const source = edge.source as string
    if (source) {
      outgoingCount.set(source, (outgoingCount.get(source) ?? 0) + 1)
    }
  }
  const hasBranching = Array.from(outgoingCount.values()).some((c) => c > 1)

  if (nodeCount >= 6 || hasBranching) return "intermediate"

  return "simple"
}

/** Execution data keys to strip from snapshot nodes. */
const EXECUTION_DATA_KEYS = [
  "result", "status", "progress",
  "generatedImageUrl", "generatedVideoUrl", "generatedAudioUrl",
  "generatedText", "generatedItems", "generatedResults",
  "__listResults", "__listTotal", "__listCompleted",
]

/** Deep clone nodes and remove execution-related data. */
function stripExecutionData(nodes: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return nodes.map((node) => {
    const cloned = JSON.parse(JSON.stringify(node)) as Record<string, unknown>
    const data = cloned.data as Record<string, unknown> | undefined
    if (data) {
      for (const key of EXECUTION_DATA_KEYS) {
        delete data[key]
      }
    }
    return cloned
  })
}

/** Derive a preview media URL from snapshot nodes. */
function derivePreviewMedia(
  nodes: Array<Record<string, unknown>>,
): { url: string; type: "image" | "video" } | null {
  // Fallback: first image or video node with a result
  for (const n of nodes) {
    const otype = getOutputType(n.type as string)
    if ((otype === "image" || otype === "video") && n.data) {
      const result = getNodeResult(n.data as Record<string, unknown>)
      if (result.url) return { url: result.url, type: otype }
    }
  }

  return null
}

// sanitizeSlugBase, generateSlug, getCreatorDisplayName imported from lib/marketplace-helpers.ts

/** Full camelCase transform for a template row. */
function toCamelCase(row: Record<string, unknown>) {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    creatorId: row.creator_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    markdownDescription: row.markdown_description ?? null,
    snapshotNodes: row.snapshot_nodes,
    snapshotEdges: row.snapshot_edges,
    snapshotSettings: row.snapshot_settings,
    isActive: row.is_active,
    isListed: row.is_listed,
    estimatedCredits: row.estimated_credits,
    category: row.category ?? "other",
    outputTypes: row.output_types ?? [],
    tags: row.tags ?? [],
    nodeTypesUsed: row.node_types_used ?? [],
    providersUsed: row.providers_used ?? [],
    nodeCount: row.node_count ?? 0,
    complexity: row.complexity ?? "simple",
    previewMediaUrl: row.preview_media_url ?? null,
    previewMediaType: row.preview_media_type ?? null,
    creatorDisplayName: row.creator_display_name ?? null,
    cloneCount: row.clone_count ?? 0,
    favoriteCount: row.favorite_count ?? 0,
    createdAt: row.created_at,
  }
}

/** Slim card-only transform for browse results (no snapshot data). */
function toBrowseCard(row: Record<string, unknown>) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    estimatedCredits: row.estimated_credits,
    category: row.category ?? "other",
    outputTypes: row.output_types ?? [],
    tags: row.tags ?? [],
    nodeTypesUsed: row.node_types_used ?? [],
    providersUsed: row.providers_used ?? [],
    nodeCount: row.node_count ?? 0,
    complexity: row.complexity ?? "simple",
    previewMediaUrl: row.preview_media_url ?? null,
    previewMediaType: row.preview_media_type ?? null,
    creatorId: row.creator_id,
    creatorDisplayName: row.creator_display_name ?? null,
    cloneCount: row.clone_count ?? 0,
    favoriteCount: row.favorite_count ?? 0,
    createdAt: row.created_at,
  }
}

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

const publishBodySchema = z.object({
  workflowId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  markdownDescription: z.string().max(5000).optional(),
  slug: z.string().min(1).max(50).optional(),
  category: z.enum(VALID_CATEGORIES).optional(),
  outputTypes: z.array(z.enum(VALID_OUTPUT_TYPES)).max(4).optional(),
  tags: z.array(z.string().max(30)).max(10).optional(),
  previewMediaUrl: z.string().url().optional(),
  previewMediaType: z.enum(["image", "video"]).optional(),
  isListed: z.boolean().optional(),
})

const updateBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  markdownDescription: z.string().max(5000).optional(),
  isActive: z.boolean().optional(),
  isListed: z.boolean().optional(),
  category: z.enum(VALID_CATEGORIES).optional(),
  outputTypes: z.array(z.enum(VALID_OUTPUT_TYPES)).max(4).optional(),
  tags: z.array(z.string().max(30)).max(10).optional(),
  previewMediaUrl: z.string().url().nullable().optional(),
  previewMediaType: z.enum(["image", "video"]).nullable().optional(),
})

const browseQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  category: z.enum(VALID_CATEGORIES).optional(),
  outputType: z.enum(VALID_OUTPUT_TYPES).optional(),
  tag: z.string().max(30).optional(),
  search: z.string().max(100).optional(),
  sort: z.enum(["popular", "newest", "most-favorited"]).optional().default("popular"),
  nodeType: z.string().optional(),
  provider: z.string().optional(),
  complexity: z.enum(VALID_COMPLEXITIES).optional(),
})

const cloneBodySchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
})

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function workflowTemplatesRoutes(app: FastifyInstance) {
  // =========================================================================
  // 1. GET /v1/templates/browse — Public marketplace browse
  // =========================================================================
  app.get("/v1/templates/browse", async (req, reply) => {
    const parsed = browseQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    const { cursor, limit, category, outputType, tag, search, sort, nodeType, provider, complexity } = parsed.data

    // Card-only columns (no snapshot_nodes/edges/settings)
    const selectCols = "id, slug, name, description, estimated_credits, category, output_types, tags, node_types_used, providers_used, node_count, complexity, preview_media_url, preview_media_type, creator_id, creator_display_name, clone_count, favorite_count, created_at"

    let query = supabase
      .from("workflow_templates")
      .select(selectCols)
      .eq("is_listed", true)
      .eq("is_active", true)
      .limit(limit + 1) // fetch one extra to detect next page

    // Filters
    if (category) query = query.eq("category", category)
    if (outputType) query = query.contains("output_types", [outputType])
    if (tag) query = query.contains("tags", [tag])
    if (nodeType) query = query.contains("node_types_used", [nodeType])
    if (provider) query = query.contains("providers_used", [provider])
    if (complexity) query = query.eq("complexity", complexity)

    // Full-text search
    if (search) {
      const tsQuery = search.trim().split(/\s+/).join(" & ")
      query = query.textSearch("search_vector", tsQuery)
    }

    // Sort + cursor
    if (sort === "popular") {
      query = query.order("clone_count", { ascending: false }).order("created_at", { ascending: false })
      if (cursor) {
        const [countStr, dateStr] = cursor.split(":")
        const countVal = Number(countStr)
        if (!isNaN(countVal) && dateStr) {
          query = query.or(`clone_count.lt.${countVal},and(clone_count.eq.${countVal},created_at.lt.${dateStr})`)
        }
      }
    } else if (sort === "most-favorited") {
      query = query.order("favorite_count", { ascending: false }).order("created_at", { ascending: false })
      if (cursor) {
        const [countStr, dateStr] = cursor.split(":")
        const countVal = Number(countStr)
        if (!isNaN(countVal) && dateStr) {
          query = query.or(`favorite_count.lt.${countVal},and(favorite_count.eq.${countVal},created_at.lt.${dateStr})`)
        }
      }
    } else {
      // newest
      query = query.order("created_at", { ascending: false })
      if (cursor) {
        query = query.lt("created_at", cursor)
      }
    }

    const { data: rows, error } = await query

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: "Failed to browse templates" } })
    }

    const items = (rows ?? []).slice(0, limit)
    const hasMore = (rows ?? []).length > limit

    let nextCursor: string | null = null
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1] as Record<string, unknown>
      if (sort === "popular") {
        nextCursor = `${last.clone_count}:${last.created_at}`
      } else if (sort === "most-favorited") {
        nextCursor = `${last.favorite_count}:${last.created_at}`
      } else {
        nextCursor = last.created_at as string
      }
    }

    reply.header("Cache-Control", "public, max-age=30, stale-while-revalidate=86400")
    return reply.send({
      data: items.map((r: unknown) => toBrowseCard(r as Record<string, unknown>)),
      nextCursor,
    })
  })

  // =========================================================================
  // 2. POST /v1/templates/publish — Publish a workflow as a template
  // =========================================================================
  app.post("/v1/templates/publish", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })

    const parsed = publishBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    const {
      workflowId, name, description, markdownDescription, slug: providedSlug,
      category, outputTypes, tags, previewMediaUrl, previewMediaType, isListed,
    } = parsed.data

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

    const nodes = (workflow.nodes || []) as Array<Record<string, unknown>>
    const edges = (workflow.edges || []) as Array<Record<string, unknown>>

    // Auto-derive metadata
    const nodeTypesUsed = extractNodeTypes(nodes)
    const providersUsed = extractProviders(nodes)
    const nodeCount = nodes.length
    const complexity = calculateComplexity(nodes, edges)
    const estimatedCredits = estimateWorkflowCredits(nodes as Array<{ type: string; data?: Record<string, unknown> }>)
    const snapshotNodes = nodes

    // Auto-derive preview media from snapshot nodes if not provided
    let effectivePreviewUrl = previewMediaUrl ?? null
    let effectivePreviewType = previewMediaType ?? null
    if (!effectivePreviewUrl) {
      const derived = derivePreviewMedia(nodes)
      if (derived) {
        effectivePreviewUrl = derived.url
        effectivePreviewType = derived.type
      }
    }

    // Get creator display name
    const creatorDisplayName = await getCreatorDisplayName(userId)

    // Check if template already exists for this workflow + creator
    const { data: existingTemplate } = await supabase
      .from("workflow_templates")
      .select("id, slug, name, is_listed")
      .eq("workflow_id", workflowId)
      .eq("creator_id", userId)
      .eq("is_active", true)
      .maybeSingle()

    if (existingTemplate) {
      // UPDATE existing template
      const updates: Record<string, unknown> = {
        name,
        description: description || null,
        markdown_description: markdownDescription || null,
        snapshot_nodes: snapshotNodes,
        snapshot_edges: edges,
        snapshot_settings: workflow.settings || {},
        node_types_used: nodeTypesUsed,
        providers_used: providersUsed,
        node_count: nodeCount,
        complexity,
        estimated_credits: estimatedCredits,
        category: category ?? "other",
        output_types: outputTypes ?? [],
        tags: tags ?? [],
        preview_media_url: effectivePreviewUrl,
        preview_media_type: effectivePreviewType,
        creator_display_name: creatorDisplayName,
        is_listed: isListed ?? existingTemplate.is_listed,
      }

      // Reset slug only if name changed
      if (name !== existingTemplate.name) {
        const newSlug = providedSlug ? generateSlug(providedSlug) : generateSlug(name)
        updates.slug = newSlug
      }

      const { data: updated, error: updateError } = await supabase
        .from("workflow_templates")
        .update(updates)
        .eq("id", existingTemplate.id)
        .select()
        .single()

      if (updateError || !updated) {
        return reply.status(500).send({ error: { code: "internal_error", message: "Failed to update template" } })
      }

      return reply.send(toCamelCase(updated as Record<string, unknown>))
    }

    // INSERT new template with slug collision retry
    const MAX_SLUG_RETRIES = 5
    let publishedTemplate: Record<string, unknown> | null = null
    let insertError: { code?: string; message?: string } | null = null

    for (let attempt = 0; attempt < MAX_SLUG_RETRIES; attempt++) {
      const slug = generateSlug(attempt === 0 && providedSlug ? providedSlug : name)

      const result = await supabase
        .from("workflow_templates")
        .insert({
          workflow_id: workflowId,
          creator_id: userId,
          name,
          description: description || null,
          markdown_description: markdownDescription || null,
          slug,
          snapshot_nodes: snapshotNodes,
          snapshot_edges: edges,
          snapshot_settings: workflow.settings || {},
          node_types_used: nodeTypesUsed,
          providers_used: providersUsed,
          node_count: nodeCount,
          complexity,
          estimated_credits: estimatedCredits,
          category: category ?? "other",
          output_types: outputTypes ?? [],
          tags: tags ?? [],
          preview_media_url: effectivePreviewUrl,
          preview_media_type: effectivePreviewType,
          is_listed: isListed ?? false,
          creator_display_name: creatorDisplayName,
        })
        .select()
        .single()

      if (!result.error) {
        publishedTemplate = result.data
        insertError = null
        break
      }

      // Unique constraint violation — retry with a new random suffix
      if (result.error.code === "23505") {
        insertError = result.error
        continue
      }

      insertError = result.error
      break
    }

    if (insertError || !publishedTemplate) {
      return reply.status(500).send({ error: { code: "internal_error", message: "Failed to publish template" } })
    }

    return reply.send(toCamelCase(publishedTemplate))
  })

  // =========================================================================
  // 3. GET /v1/templates/mine — List creator's templates
  // =========================================================================
  app.get("/v1/templates/mine", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })

    const { data: templates, error } = await supabase
      .from("workflow_templates")
      .select("*")
      .eq("creator_id", userId)
      .order("created_at", { ascending: false })

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: "Failed to fetch templates" } })
    }

    return reply.send((templates || []).map((t: unknown) => toCamelCase(t as Record<string, unknown>)))
  })

  // =========================================================================
  // 4. GET /v1/templates/:slug — Public single template with full snapshot
  // =========================================================================
  app.get("/v1/templates/:slug", async (req, reply) => {
    const { slug } = req.params as { slug: string }

    const { data: template, error } = await supabase
      .from("workflow_templates")
      .select("*")
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle()

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: "Failed to fetch template" } })
    }
    if (!template) {
      return reply.status(404).send({ error: { code: "not_found", message: "Template not found" } })
    }

    return reply.send(toCamelCase(template as Record<string, unknown>))
  })

  // =========================================================================
  // 5. POST /v1/templates/favorite — Toggle favorite
  // =========================================================================
  app.post("/v1/templates/favorite", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })

    const parsed = z.object({ templateId: z.string().uuid() }).safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    const { templateId } = parsed.data

    // Check if already favorited
    const { data: existing } = await supabase
      .from("template_favorites")
      .select("id")
      .eq("user_id", userId)
      .eq("template_id", templateId)
      .maybeSingle()

    if (existing) {
      // Remove favorite
      await supabase.from("template_favorites").delete().eq("id", existing.id)
      return reply.send({ favorited: false })
    }

    // Add favorite
    const { error } = await supabase
      .from("template_favorites")
      .insert({ user_id: userId, template_id: templateId })

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: "Failed to favorite template" } })
    }

    return reply.send({ favorited: true })
  })

  // =========================================================================
  // 6. GET /v1/templates/favorites — User's favorited template IDs
  // =========================================================================
  app.get("/v1/templates/favorites", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })

    const { data, error } = await supabase
      .from("template_favorites")
      .select("template_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: "Failed to fetch favorites" } })
    }

    return reply.send({ data: (data ?? []).map((f: { template_id: string }) => f.template_id) })
  })

  // =========================================================================
  // 7. POST /v1/templates/:slug/clone — Clone template into a project (FREE)
  // =========================================================================
  app.post("/v1/templates/:slug/clone", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })

    const { slug } = req.params as { slug: string }

    const parsed = cloneBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    const { projectId, name: customName } = parsed.data

    // Load template by slug
    const { data: template, error: tplError } = await supabase
      .from("workflow_templates")
      .select("*")
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle()

    if (tplError || !template) {
      return reply.status(404).send({ error: { code: "not_found", message: "Template not found" } })
    }

    // Verify target project belongs to user
    const { data: project, error: projError } = await supabase
      .from("projects")
      .select("id, user_id")
      .eq("id", projectId)
      .single()

    if (projError || !project) {
      return reply.status(404).send({ error: { code: "not_found", message: "Project not found" } })
    }
    if (project.user_id !== userId) {
      return reply.status(403).send({ error: { code: "forbidden", message: "Not your project" } })
    }

    // Strip execution data from snapshot nodes
    const cleanNodes = (template.snapshot_nodes || []) as Array<Record<string, unknown>>

    // Create new workflow in target project
    const workflowName = customName || template.name
    const { data: newWorkflow, error: wfError } = await supabase
      .from("workflows")
      .insert({
        project_id: projectId,
        user_id: userId,
        name: workflowName,
        nodes: cleanNodes,
        edges: template.snapshot_edges || [],
        settings: template.snapshot_settings || {},
        template_id: template.id,
      })
      .select("id")
      .single()

    if (wfError || !newWorkflow) {
      return reply.status(500).send({ error: { code: "internal_error", message: "Failed to clone template" } })
    }

    // Increment clone_count
    await supabase
      .from("workflow_templates")
      .update({ clone_count: (template.clone_count ?? 0) + 1 })
      .eq("id", template.id)

    return reply.send({ workflowId: newWorkflow.id, projectId })
  })

  // =========================================================================
  // 8. PATCH /v1/templates/:templateId — Update template metadata
  // =========================================================================
  app.patch("/v1/templates/:templateId", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })

    const { templateId } = req.params as { templateId: string }

    const parsed = updateBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    // Verify ownership
    const { data: existing, error: fetchError } = await supabase
      .from("workflow_templates")
      .select("id, creator_id")
      .eq("id", templateId)
      .single()

    if (fetchError || !existing) {
      return reply.status(404).send({ error: { code: "not_found", message: "Template not found" } })
    }
    if (existing.creator_id !== userId) {
      return reply.status(403).send({ error: { code: "forbidden", message: "Not your template" } })
    }

    // Build update object from provided fields
    const updates: Record<string, unknown> = {}
    const body = parsed.data
    if (body.name !== undefined) updates.name = body.name
    if (body.description !== undefined) updates.description = body.description
    if (body.markdownDescription !== undefined) updates.markdown_description = body.markdownDescription
    if (body.isActive !== undefined) updates.is_active = body.isActive
    if (body.isListed !== undefined) updates.is_listed = body.isListed
    if (body.category !== undefined) updates.category = body.category
    if (body.outputTypes !== undefined) updates.output_types = body.outputTypes
    if (body.tags !== undefined) updates.tags = body.tags
    if (body.previewMediaUrl !== undefined) updates.preview_media_url = body.previewMediaUrl
    if (body.previewMediaType !== undefined) updates.preview_media_type = body.previewMediaType

    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ error: { code: "bad_request", message: "No fields to update" } })
    }

    const { data: updated, error: updateError } = await supabase
      .from("workflow_templates")
      .update(updates)
      .eq("id", templateId)
      .select()
      .single()

    if (updateError) {
      return reply.status(500).send({ error: { code: "internal_error", message: "Failed to update template" } })
    }

    return reply.send(toCamelCase(updated as Record<string, unknown>))
  })

  // =========================================================================
  // 9. DELETE /v1/templates/:templateId — Soft delete (is_active = false)
  // =========================================================================
  app.delete("/v1/templates/:templateId", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })

    const { templateId } = req.params as { templateId: string }

    // Verify ownership
    const { data: existing, error: fetchError } = await supabase
      .from("workflow_templates")
      .select("id, creator_id")
      .eq("id", templateId)
      .single()

    if (fetchError || !existing) {
      return reply.status(404).send({ error: { code: "not_found", message: "Template not found" } })
    }
    if (existing.creator_id !== userId) {
      return reply.status(403).send({ error: { code: "forbidden", message: "Not your template" } })
    }

    const { error: updateError } = await supabase
      .from("workflow_templates")
      .update({ is_active: false })
      .eq("id", templateId)

    if (updateError) {
      return reply.status(500).send({ error: { code: "internal_error", message: "Failed to deactivate template" } })
    }

    return reply.send({ success: true })
  })
}
