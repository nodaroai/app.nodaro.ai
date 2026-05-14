// Public GET /v1/tutorials — unified video + flow tutorials grouped by category.
//
// Two separate Supabase queries (video tutorials from `tutorials`, flow
// tutorials from `workflow_templates` flagged with 'tutorial' in listed_in),
// then merged in code under the shared `tutorial_categories` taxonomy.

import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase.js"

interface CategoryRow {
  id: string
  name: string
  slug: string
  sort_order: number
}

interface VideoRow {
  id: string
  title: string
  description: string | null
  video_url: string
  thumbnail_url: string | null
  category_id: string
  sort_order: number
  created_at: string
  updated_at: string
}

interface FlowRow {
  id: string
  slug: string | null
  name: string
  description: string | null
  markdown_description: string | null
  preview_media_url: string | null
  preview_media_type: string | null
  complexity: string | null
  estimated_credits: number | null
  node_types_used: string[] | null
  providers_used: string[] | null
  node_count: number | null
  tutorial_category_id: string
  tutorial_sort_order: number
  workflow_id: string
  created_at: string
}

function toVideoResponse(row: VideoRow) {
  return {
    id: row.id,
    type: "video" as const,
    title: row.title,
    description: row.description,
    videoUrl: row.video_url,
    thumbnailUrl: row.thumbnail_url,
    categoryId: row.category_id,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toFlowResponse(row: FlowRow) {
  return {
    id: row.id,
    type: "flow" as const,
    templateId: row.id,
    slug: row.slug,
    title: row.name,
    description: row.description,
    markdownDescription: row.markdown_description,
    previewMediaUrl: row.preview_media_url,
    previewMediaType: row.preview_media_type,
    complexity: row.complexity ?? "simple",
    estimatedCredits: row.estimated_credits ?? 0,
    nodeTypesUsed: row.node_types_used ?? [],
    providersUsed: row.providers_used ?? [],
    nodeCount: row.node_count ?? 0,
    categoryId: row.tutorial_category_id,
    tutorialSortOrder: row.tutorial_sort_order,
    workflowId: row.workflow_id,
    createdAt: row.created_at,
  }
}

export async function tutorialsRoutes(app: FastifyInstance) {
  // GET /v1/tutorials — public, grouped by category
  app.get("/v1/tutorials", async (_req, reply) => {
    // Pull everything in parallel: categories, videos, flows.
    const [catsResult, videosResult, flowsResult] = await Promise.all([
      supabase
        .from("tutorial_categories")
        .select("id, name, slug, sort_order")
        .eq("is_enabled", true)
        .order("sort_order"),
      supabase
        .from("tutorials")
        .select(
          "id, title, description, video_url, thumbnail_url, category_id, sort_order, created_at, updated_at",
        )
        .eq("is_enabled", true)
        .order("sort_order"),
      supabase
        .from("workflow_templates")
        .select(
          "id, slug, name, description, markdown_description, preview_media_url, preview_media_type, complexity, estimated_credits, node_types_used, providers_used, node_count, tutorial_category_id, tutorial_sort_order, workflow_id, created_at",
        )
        .contains("listed_in", ["tutorial"])
        .eq("is_active", true)
        .order("tutorial_sort_order"),
    ])

    if (catsResult.error) {
      return reply
        .status(500)
        .send({ error: { code: "internal_error", message: catsResult.error.message } })
    }
    if (videosResult.error) {
      return reply
        .status(500)
        .send({ error: { code: "internal_error", message: videosResult.error.message } })
    }
    if (flowsResult.error) {
      return reply
        .status(500)
        .send({ error: { code: "internal_error", message: flowsResult.error.message } })
    }

    const categories = (catsResult.data ?? []) as CategoryRow[]
    const videos = (videosResult.data ?? []) as VideoRow[]
    const flows = (flowsResult.data ?? []) as FlowRow[]

    // Bucket items by category_id.
    const videosByCat = new Map<string, VideoRow[]>()
    for (const v of videos) {
      const list = videosByCat.get(v.category_id) ?? []
      list.push(v)
      videosByCat.set(v.category_id, list)
    }

    const flowsByCat = new Map<string, FlowRow[]>()
    for (const f of flows) {
      // tutorial_category_id is NOT NULL when 'tutorial' ∈ listed_in (CHECK
      // constraint in migration 114), but be defensive anyway.
      if (!f.tutorial_category_id) continue
      const list = flowsByCat.get(f.tutorial_category_id) ?? []
      list.push(f)
      flowsByCat.set(f.tutorial_category_id, list)
    }

    const responseCategories = categories.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      sortOrder: c.sort_order,
      videos: (videosByCat.get(c.id) ?? []).map(toVideoResponse),
      flows: (flowsByCat.get(c.id) ?? []).map(toFlowResponse),
    }))

    return { categories: responseCategories }
  })
}
