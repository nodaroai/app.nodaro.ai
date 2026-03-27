import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { estimateWorkflowCredits } from "../billing/credits.js"
import { invalidateAppCache } from "./app-runner.js"
import { getNodeResult, getOutputType } from "../../../packages/shared/src/presentation-utils.js"
import { calculateMonetizationMarkup, calculateMonetizedCost } from "../../../packages/shared/src/monetization.js"
import { sanitizeSlugBase, generateSlug, getCreatorDisplayName } from "../lib/marketplace-helpers.js"

const VALID_CATEGORIES = [
  "image-generation", "video-production", "audio-music", "content-writing",
  "social-media", "data-processing", "multi-step", "other",
] as const

const VALID_OUTPUT_TYPES = ["image", "video", "audio", "text"] as const

/** Derive a preview media URL from snapshot nodes (thumbnail node or first image/video output). */
function derivePreviewMedia(
  nodes: Array<Record<string, unknown>>,
  thumbnailNodeId?: string | null,
): { url: string; type: "image" | "video" } | null {
  // Try thumbnail node first
  if (thumbnailNodeId) {
    const thumbNode = nodes.find((n) => n.id === thumbnailNodeId)
    if (thumbNode?.data) {
      const result = getNodeResult(thumbNode.data as Record<string, unknown>)
      if (result.url) {
        const otype = getOutputType(thumbNode.type as string)
        return { url: result.url, type: otype === "video" ? "video" : "image" }
      }
    }
  }

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

// sanitizeSlugBase, generateSlug imported from lib/marketplace-helpers.ts

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
    baseEstimatedCredits: row.base_estimated_credits ?? 0,
    thumbnailNodeId: row.thumbnail_node_id ?? null,
    category: row.category ?? "other",
    outputTypes: row.output_types ?? [],
    tags: row.tags ?? [],
    previewMediaUrl: row.preview_media_url ?? null,
    previewMediaType: row.preview_media_type ?? null,
    supportsRemix: row.supports_remix ?? false,
    creatorDisplayName: row.creator_display_name ?? null,
    totalRunCount: row.total_run_count ?? 0,
    favoriteCount: row.favorite_count ?? 0,
    createdAt: row.created_at,
    monetizationEnabled: row.monetization_enabled ?? false,
    monetizationFlatFee: row.monetization_flat_fee ?? 0,
    monetizationPercent: row.monetization_percent ?? 0,
    publishType: row.publish_type ?? "app",
    componentMetadata: row.component_metadata ?? null,
  }
}

/** Slim card-only transform for browse results (no snapshot data) */
function toBrowseCard(row: Record<string, unknown>) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    iconUrl: row.icon_url,
    estimatedCredits: row.estimated_credits,
    category: row.category ?? "other",
    outputTypes: row.output_types ?? [],
    tags: row.tags ?? [],
    previewMediaUrl: row.preview_media_url ?? null,
    previewMediaType: row.preview_media_type ?? null,
    supportsRemix: row.supports_remix ?? false,
    creatorId: row.creator_id,
    creatorDisplayName: row.creator_display_name ?? null,
    totalRunCount: row.total_run_count ?? 0,
    favoriteCount: row.favorite_count ?? 0,
    monetizationEnabled: row.monetization_enabled ?? false,
    publishType: row.publish_type ?? "app",
    componentMetadata: row.component_metadata ?? null,
    createdAt: row.created_at,
  }
}

const componentIOSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  type: z.enum(["image", "video", "audio", "text"]),
  required: z.boolean(),
  mediaPreview: z.boolean().optional(),
  fieldKey: z.string(),
})

const componentMetadataSchema = z.object({
  inputs: z.array(componentIOSchema).min(1),
  outputs: z.array(componentIOSchema).min(1),
  exposedSettings: z.array(z.object({
    nodeId: z.string(),
    field: z.string(),
    label: z.string(),
    type: z.enum(["select", "text", "number", "toggle"]),
    allowedValues: z.array(z.unknown()).optional(),
    defaultValue: z.unknown(),
  })),
})

const publishBodySchema = z.object({
  workflowId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  slug: z.string().min(1).max(50).optional(),
  iconUrl: z.string().url().optional(),
  thumbnailNodeId: z.string().max(100).nullable().optional(),
  // Marketplace fields
  category: z.enum(VALID_CATEGORIES).optional(),
  outputTypes: z.array(z.enum(VALID_OUTPUT_TYPES)).max(4).optional(),
  tags: z.array(z.string().max(30)).max(10).optional(),
  previewMediaUrl: z.string().url().optional(),
  previewMediaType: z.enum(["image", "video"]).optional(),
  supportsRemix: z.boolean().optional(),
  isListed: z.boolean().optional(),
  // Component fields
  publishType: z.enum(["app", "component"]).optional(),
  componentMetadata: componentMetadataSchema.optional(),
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
  // Marketplace fields
  category: z.enum(VALID_CATEGORIES).optional(),
  outputTypes: z.array(z.enum(VALID_OUTPUT_TYPES)).max(4).optional(),
  tags: z.array(z.string().max(30)).max(10).optional(),
  previewMediaUrl: z.string().url().nullable().optional(),
  previewMediaType: z.enum(["image", "video"]).nullable().optional(),
  supportsRemix: z.boolean().optional(),
  // Monetization fields
  monetizationEnabled: z.boolean().optional(),
  monetizationFlatFee: z.number().int().min(0).optional(),
  monetizationPercent: z.number().int().min(0).max(500).optional(),
})

const browseQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  category: z.enum(VALID_CATEGORIES).optional(),
  outputType: z.enum(VALID_OUTPUT_TYPES).optional(),
  tag: z.string().max(30).optional(),
  search: z.string().max(100).optional(),
  sort: z.enum(["popular", "newest", "most-favorited"]).optional().default("popular"),
  creatorId: z.string().uuid().optional(),
  favoritesOnly: z.coerce.boolean().optional(),
  publishType: z.enum(["app", "component"]).optional(),
})

// getCreatorDisplayName imported from lib/marketplace-helpers.ts

export async function publishedAppsRoutes(app: FastifyInstance) {
  // GET /v1/apps/browse — Public marketplace browse
  app.get("/v1/apps/browse", async (req, reply) => {
    const parsed = browseQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    const { cursor, limit, category, outputType, tag, search, sort, creatorId, favoritesOnly, publishType } = parsed.data

    // If favoritesOnly, require auth
    if (favoritesOnly && !req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required for favorites" } })
    }

    // Card-only columns (no snapshot_nodes/edges/settings)
    const selectCols = "id, slug, name, description, icon_url, estimated_credits, category, output_types, tags, preview_media_url, preview_media_type, supports_remix, creator_id, creator_display_name, total_run_count, favorite_count, created_at, monetization_enabled, publish_type, component_metadata"

    let query = supabase
      .from("published_apps")
      .select(selectCols)
      .eq("is_listed", true)
      .eq("is_active", true)
      .limit(limit + 1) // fetch one extra to detect next page

    // Filters
    if (category) query = query.eq("category", category)
    if (outputType) query = query.contains("output_types", [outputType])
    if (tag) query = query.contains("tags", [tag])
    if (creatorId) query = query.eq("creator_id", creatorId)
    if (publishType) query = query.eq("publish_type", publishType)

    // Full-text search
    if (search) {
      const tsQuery = search.trim().split(/\s+/).join(" & ")
      query = query.textSearch("search_vector", tsQuery)
    }

    // Favorites-only filter
    if (favoritesOnly && req.userId) {
      const { data: favIds } = await supabase
        .from("app_favorites")
        .select("app_id")
        .eq("user_id", req.userId)
      const ids = (favIds ?? []).map((f: { app_id: string }) => f.app_id)
      if (ids.length === 0) {
        return reply.send({ data: [], nextCursor: null })
      }
      query = query.in("id", ids)
    }

    // Sort + cursor
    if (sort === "popular") {
      query = query.order("total_run_count", { ascending: false }).order("created_at", { ascending: false })
      if (cursor) {
        // cursor = "runCount:createdAt"
        const [countStr, dateStr] = cursor.split(":")
        const countVal = Number(countStr)
        if (!isNaN(countVal) && dateStr) {
          query = query.or(`total_run_count.lt.${countVal},and(total_run_count.eq.${countVal},created_at.lt.${dateStr})`)
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
      return reply.status(500).send({ error: { code: "internal_error", message: "Failed to browse apps" } })
    }

    const items = (rows ?? []).slice(0, limit)
    const hasMore = (rows ?? []).length > limit

    let nextCursor: string | null = null
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1] as Record<string, unknown>
      if (sort === "popular") {
        nextCursor = `${last.total_run_count}:${last.created_at}`
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

  // GET /v1/apps/by-slug/:slug/latest-version — Check latest version of a published app/component
  app.get("/v1/apps/by-slug/:slug/latest-version", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })

    const { slug } = req.params as { slug: string }
    const { data } = await supabase
      .from("published_apps")
      .select("id, version")
      .eq("slug", slug)
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .single()

    if (!data) return reply.status(404).send({ error: "Component not found" })
    return { latestVersion: data.version, latestVersionId: data.id }
  })

  // POST /v1/apps/favorite — Toggle favorite
  app.post("/v1/apps/favorite", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })

    const parsed = z.object({ appId: z.string().uuid() }).safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    const { appId } = parsed.data

    // Check if already favorited
    const { data: existing } = await supabase
      .from("app_favorites")
      .select("id")
      .eq("user_id", userId)
      .eq("app_id", appId)
      .maybeSingle()

    if (existing) {
      // Remove favorite
      await supabase.from("app_favorites").delete().eq("id", existing.id)
      return reply.send({ favorited: false })
    }

    // Add favorite
    const { error } = await supabase
      .from("app_favorites")
      .insert({ user_id: userId, app_id: appId })

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: "Failed to favorite app" } })
    }

    return reply.send({ favorited: true })
  })

  // GET /v1/apps/favorites — Get user's favorited app IDs
  app.get("/v1/apps/favorites", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })

    const { data, error } = await supabase
      .from("app_favorites")
      .select("app_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: "Failed to fetch favorites" } })
    }

    return reply.send({ data: (data ?? []).map((f: { app_id: string }) => f.app_id) })
  })

  // POST /v1/apps/publish — Publish a workflow as an app
  app.post("/v1/apps/publish", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })

    const parsed = publishBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    const {
      workflowId, name, description, slug: providedSlug, iconUrl, thumbnailNodeId,
      category, outputTypes, tags, previewMediaUrl, previewMediaType, supportsRemix, isListed,
      publishType: rawPublishType, componentMetadata,
    } = parsed.data

    const publishType = rawPublishType ?? "app"

    // Validate component metadata when publishing as a component
    if (publishType === "component") {
      if (!componentMetadata) {
        return reply.status(400).send({ error: { code: "bad_request", message: "componentMetadata is required for component publish type" } })
      }

      // Exactly one output must have mediaPreview: true
      const previewOutputs = componentMetadata.outputs.filter((o) => o.mediaPreview)
      if (previewOutputs.length !== 1) {
        return reply.status(400).send({ error: { code: "bad_request", message: "Exactly one output must have mediaPreview: true" } })
      }
    }

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

    // Validate component handles and exposed settings against snapshot nodes
    if (publishType === "component" && componentMetadata) {
      const snapshotNodes = (workflow.nodes || []) as Array<Record<string, unknown>>
      const nodeIds = new Set(snapshotNodes.map((n) => n.id as string))

      // Validate input/output handle IDs reference real nodes
      for (const input of componentMetadata.inputs) {
        if (!nodeIds.has(input.id)) {
          return reply.status(400).send({ error: { code: "bad_request", message: `Input handle references unknown node: ${input.id}` } })
        }
      }
      for (const output of componentMetadata.outputs) {
        if (!nodeIds.has(output.id)) {
          return reply.status(400).send({ error: { code: "bad_request", message: `Output handle references unknown node: ${output.id}` } })
        }
      }

      // Validate exposed setting nodeIds reference real nodes
      for (const setting of componentMetadata.exposedSettings) {
        if (!nodeIds.has(setting.nodeId)) {
          return reply.status(400).send({ error: { code: "bad_request", message: `Exposed setting references unknown node: ${setting.nodeId}` } })
        }
      }
    }

    // Compute version + deactivate old versions
    const { data: existingApps } = await supabase
      .from("published_apps")
      .select("id, version, slug, is_listed, monetization_enabled, monetization_flat_fee, monetization_percent")
      .eq("workflow_id", workflowId)
      .order("version", { ascending: false })
      .limit(1)

    const prevVersion = existingApps && existingApps.length > 0 ? existingApps[0] : null
    const version = prevVersion ? prevVersion.version + 1 : 1

    // Reuse slug from previous version so the app URL stays stable across versions
    const inheritedSlug = prevVersion?.slug ?? null

    // Auto-deactivate all previous versions and retire their slugs to free the
    // UNIQUE constraint — new version inherits the original slug.
    if (prevVersion) {
      const { data: allOldVersions } = await supabase
        .from("published_apps")
        .select("id, version, slug")
        .eq("workflow_id", workflowId)
        .eq("creator_id", userId)

      if (allOldVersions) {
        for (const old of allOldVersions) {
          await supabase
            .from("published_apps")
            .update({
              is_active: false,
              is_listed: false,
              slug: `${old.slug}-v${old.version}`,
            })
            .eq("id", old.id)
        }
      }
    }

    // Carry forward listing status from previous version if not explicitly set
    const prevWasListed = prevVersion?.is_listed ?? false
    const effectiveIsListed = isListed ?? prevWasListed

    // Estimate credits
    const nodes = workflow.nodes || []
    const edges = workflow.edges || []
    const baseEstimatedCredits = estimateWorkflowCredits(nodes as Array<{ type: string; data?: Record<string, unknown> }>)

    // Inherit monetization from previous version, then user defaults, then zeros
    let inheritedMonetizationEnabled = false
    let inheritedMonetizationFlatFee = 0
    let inheritedMonetizationPercent = 0

    if (prevVersion) {
      inheritedMonetizationEnabled = prevVersion.monetization_enabled ?? false
      inheritedMonetizationFlatFee = prevVersion.monetization_flat_fee ?? 0
      inheritedMonetizationPercent = prevVersion.monetization_percent ?? 0
    } else {
      // Check user's global defaults
      const { data: profile } = await supabase
        .from("profiles")
        .select("default_monetization_flat_fee, default_monetization_percent")
        .eq("id", userId)
        .single()

      if (profile) {
        const hasFee = (profile.default_monetization_flat_fee ?? 0) > 0
        const hasPct = (profile.default_monetization_percent ?? 0) > 0
        inheritedMonetizationEnabled = hasFee || hasPct
        inheritedMonetizationFlatFee = profile.default_monetization_flat_fee ?? 0
        inheritedMonetizationPercent = profile.default_monetization_percent ?? 0
      }
    }

    // Calculate estimated_credits including monetization markup
    let estimatedCredits = baseEstimatedCredits
    if (inheritedMonetizationEnabled && baseEstimatedCredits > 0) {
      estimatedCredits = calculateMonetizedCost(baseEstimatedCredits, inheritedMonetizationFlatFee, inheritedMonetizationPercent)
    }

    // Auto-derive preview media from snapshot nodes if not provided
    let effectivePreviewUrl = previewMediaUrl ?? null
    let effectivePreviewType = previewMediaType ?? null
    if (!effectivePreviewUrl) {
      const derived = derivePreviewMedia(nodes as Array<Record<string, unknown>>, thumbnailNodeId)
      if (derived) {
        effectivePreviewUrl = derived.url
        effectivePreviewType = derived.type
      }
    }

    // Get creator display name
    const creatorDisplayName = await getCreatorDisplayName(userId)

    // Generate slug with collision retry
    // Reuse inherited slug if the custom slug base matches (or no custom slug given).
    // Otherwise generate a new slug from the custom slug base with a fresh random suffix.
    const sanitizedProvided = providedSlug ? sanitizeSlugBase(providedSlug) : null
    const canReuseInherited = inheritedSlug && (
      !sanitizedProvided || inheritedSlug === sanitizedProvided || inheritedSlug.startsWith(sanitizedProvided + "-")
    )

    const MAX_SLUG_RETRIES = 5
    let publishedApp: Record<string, unknown> | null = null
    let insertError: { code?: string; message?: string } | null = null

    for (let attempt = 0; attempt < MAX_SLUG_RETRIES; attempt++) {
      const slug = attempt === 0 && canReuseInherited
        ? inheritedSlug
        : generateSlug(attempt === 0 && providedSlug ? providedSlug : name)

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
          base_estimated_credits: baseEstimatedCredits,
          estimated_credits: estimatedCredits,
          monetization_enabled: inheritedMonetizationEnabled,
          monetization_flat_fee: inheritedMonetizationFlatFee,
          monetization_percent: inheritedMonetizationPercent,
          thumbnail_node_id: thumbnailNodeId ?? null,
          category: category ?? "other",
          output_types: outputTypes ?? [],
          tags: tags ?? [],
          preview_media_url: effectivePreviewUrl,
          preview_media_type: effectivePreviewType,
          supports_remix: supportsRemix ?? false,
          is_listed: effectiveIsListed,
          creator_display_name: creatorDisplayName,
          publish_type: publishType,
          component_metadata: publishType === "component" ? componentMetadata : null,
        })
        .select()
        .single()

      if (!result.error) {
        publishedApp = result.data
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
      .select("*, app_runs(count), workflows!workflow_id(project_id)")
      .eq("creator_id", userId)
      .order("created_at", { ascending: false })

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: "Failed to fetch apps" } })
    }

    // Transform to camelCase + flatten count + extract projectId
    const result = (apps || []).map((app: any) => ({
      id: app.id,
      workflowId: app.workflow_id,
      projectId: app.workflows?.project_id ?? null,
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
      baseEstimatedCredits: app.base_estimated_credits ?? 0,
      monetizationEnabled: app.monetization_enabled ?? false,
      monetizationFlatFee: app.monetization_flat_fee ?? 0,
      monetizationPercent: app.monetization_percent ?? 0,
      thumbnailNodeId: app.thumbnail_node_id ?? null,
      category: app.category ?? "other",
      outputTypes: app.output_types ?? [],
      tags: app.tags ?? [],
      previewMediaUrl: app.preview_media_url ?? null,
      previewMediaType: app.preview_media_type ?? null,
      supportsRemix: app.supports_remix ?? false,
      creatorDisplayName: app.creator_display_name ?? null,
      totalRunCount: app.total_run_count ?? 0,
      favoriteCount: app.favorite_count ?? 0,
      createdAt: app.created_at,
      runCount: app.app_runs?.[0]?.count ?? 0,
      publishType: app.publish_type ?? "app",
      componentMetadata: app.component_metadata ?? null,
    }))

    return reply.send(result)
  })

  // GET /v1/apps/by-workflow/:workflowId — Get latest published app for a workflow (owner only)
  app.get("/v1/apps/by-workflow/:workflowId", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })

    const { workflowId } = req.params as { workflowId: string }

    const { data: appRow, error } = await supabase
      .from("published_apps")
      .select("*")
      .eq("workflow_id", workflowId)
      .eq("creator_id", userId)
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: "Failed to fetch app" } })
    }
    if (!appRow) {
      return reply.status(404).send({ error: { code: "not_found", message: "No published app found" } })
    }

    return reply.send(toCamelCase(appRow as Record<string, unknown>))
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

    // Verify ownership (include monetization fields to avoid a second SELECT)
    const { data: existing, error: fetchError } = await supabase
      .from("published_apps")
      .select("id, creator_id, base_estimated_credits, monetization_enabled, monetization_flat_fee, monetization_percent, slug")
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
    if (body.category !== undefined) updates.category = body.category
    if (body.outputTypes !== undefined) updates.output_types = body.outputTypes
    if (body.tags !== undefined) updates.tags = body.tags
    if (body.previewMediaUrl !== undefined) updates.preview_media_url = body.previewMediaUrl
    if (body.previewMediaType !== undefined) updates.preview_media_type = body.previewMediaType
    if (body.supportsRemix !== undefined) updates.supports_remix = body.supportsRemix
    if (body.monetizationEnabled !== undefined) updates.monetization_enabled = body.monetizationEnabled
    if (body.monetizationFlatFee !== undefined) updates.monetization_flat_fee = body.monetizationFlatFee
    if (body.monetizationPercent !== undefined) updates.monetization_percent = body.monetizationPercent

    // Recalculate estimated_credits when any monetization field changes
    const monetizationChanged = body.monetizationEnabled !== undefined || body.monetizationFlatFee !== undefined || body.monetizationPercent !== undefined
    if (monetizationChanged) {
      const base = existing.base_estimated_credits ?? 0
      const enabled = body.monetizationEnabled ?? existing.monetization_enabled
      const flat = body.monetizationFlatFee ?? existing.monetization_flat_fee ?? 0
      const pct = body.monetizationPercent ?? existing.monetization_percent ?? 0

      if (enabled && base > 0) {
        updates.estimated_credits = calculateMonetizedCost(base, flat, pct)
      } else {
        updates.estimated_credits = base
      }

      invalidateAppCache(existing.slug)
    }

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
