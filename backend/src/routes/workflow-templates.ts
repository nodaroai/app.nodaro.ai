import { randomUUID } from "node:crypto"
import { LISTED_PER_MINUTE_COLUMN, PER_MINUTE_SORT_COLUMN, perMinuteOf, selectWithPerMinute, writeWithPerMinute } from "../lib/listing-per-minute-columns.js"
import { typicalEpisodeCredits } from "@nodaro/render-rules"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { estimateWorkflowListingCredits, type EstimateNode, type EstimateEdge } from "../ee/billing/credits.js"
import { replyIfLlmUnpriced } from "../lib/llm-unpriced-refusal.js"
import { estimateFlagColumn, listingEstimateFlag, selectWithEstimateFlag, writeWithEstimateFlag } from "../lib/listing-estimate-flag-column.js"
import { usecaseViewerForEveryone } from "../lib/use-case/inner-availability.js"
import { selectWithMax, writeWithMax } from "../lib/listing-max-columns.js"
import { storedTemplateRange } from "../lib/app-listing-price.js"
import {
  DEFAULT_TEMPLATE_CATEGORY,
  TEMPLATE_CATEGORIES,
  getNodeResult,
  getOutputType,
  normalizeTemplateCategory,
  templateCategoryStoredValues,
} from "@nodaro/shared/apps"
import {
  UGC_NODE_TYPES,
} from "@nodaro/shared/ugc"
import { getCreatorDisplayName } from "../lib/marketplace-helpers.js"
import { templateSlugCandidate } from "../lib/template-slug.js"
import { copyToTemplateKept, copyToTemplatePreview } from "../lib/storage.js"
import { templateKeptPrefix } from "../lib/template-preview-key.js"
import { requireAdmin } from "../ee/middleware/require-admin.js"
import { hasAdmin } from "../lib/config.js"
import { checkIsAdmin } from "../lib/admin-check.js"
import { normalizeLegacyNodeTypes } from "../services/workflow-engine/normalize-node-types.js"
import { sendInternalError } from "../lib/http-errors.js"
import { accessAtLeast, workflowAccessFromRow } from "../lib/workflow-access.js"
import { toAccessRow } from "../lib/workflow-route-access.js"
import { findUnpublishableNodeTypes, unpublishableNodesMessage } from "../lib/surface-deny.js"
import { VALID_OUTPUT_TYPES, publishBodySchema } from "../lib/template-publish-schema.js"
import { resolveCanvasResultIds } from "../lib/canvas-result-ids.js"
import { exposedMediaNodeIds, exposedTextCaps } from "../lib/exposed-text-caps.js"
import { ugcPublishedGraph, type UgcKeptResults, type UgcPublishedGraph } from "../lib/ugc-composed-graph.js"
import { UGC_EXAMPLE_LINES_KEY } from "@nodaro/render-rules"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// The category enum is TEMPLATE_CATEGORIES (@nodaro/shared) — the eight use
// cases, shared with the Templates page. Rows still carrying a value from the
// previous taxonomy read as their new home (normalizeTemplateCategory) and a
// filter matches them too (templateCategoryStoredValues) until migration 423
// has rewritten them.

const VALID_COMPLEXITIES = ["simple", "intermediate", "advanced"] as const

// Listing channels stored in workflow_templates.listed_in[].
// 'marketplace' = visible in /v1/templates/browse (set by the creator).
// 'tutorial'    = surfaced in /v1/tutorials (admin-only flag).
const MARKETPLACE = "marketplace" as const
const TUTORIAL = "tutorial" as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract unique node types from a workflow's nodes, normalized to their
 * canonical form. Routing through `normalizeLegacyNodeTypes` (the single source
 * of truth) keeps the denormalized, GIN-indexed `node_types_used` facet from
 * ever carrying a retired alias — e.g. `loop` after the loop→list unification,
 * which would make the template mis-faceted under node-type filtering. Exported
 * for the facet-drift guard test; existing rows are backfilled by migration 181.
 */
export function extractNodeTypes(nodes: Array<Record<string, unknown>>): string[] {
  const types = new Set<string>()
  const normalized = normalizeLegacyNodeTypes(nodes as Array<{ type?: string; data?: unknown }>)
  for (const node of normalized) {
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

/** Is `thumbnail` the preview of the template a workflow was cloned from (`templateId`)? */
async function inheritedFromTemplate(templateId: unknown, thumbnail: string): Promise<boolean> {
  if (typeof templateId !== "string" || templateId === "") return false
  const { data } = await supabase
    // tenant-scope-ignore: a template's preview is public listing data, read by its id to compare.
    .from("workflow_templates")
    .select("preview_media_url")
    .eq("id", templateId)
    .maybeSingle()
  return typeof (data as { preview_media_url?: unknown } | null)?.preview_media_url === "string" && (data as { preview_media_url: string }).preview_media_url === thumbnail
}

/** What a publish answers about a kept run: whether one ships, and why not. */
function publicKept(kept: { readonly included: boolean; readonly reason?: string }): { included: boolean; reason?: string } {
  return kept.reason ? { included: kept.included, reason: kept.reason } : { included: kept.included }
}

/** Every string a value holds, at any depth. */
function holdsString(value: unknown, test: (s: string) => boolean, depth = 0): boolean {
  if (typeof value === "string") return test(value)
  if (depth > 8 || !value || typeof value !== "object") return false
  return (Array.isArray(value) ? value : Object.values(value)).some((item) => holdsString(item, test, depth + 1))
}

/**
 * Whether a template's current snapshot ships a kept run: a copy under its own `kept/` prefix, or a
 * script's example lines. A re-publish that does not say reads the author's last choice from it.
 */
async function snapshotKeepsRun(templateId: string): Promise<boolean> {
  const { data } = await supabase
    // tenant-scope-ignore: read by the id of the caller's own template, found above by creator.
    .from("workflow_templates")
    .select("snapshot_nodes")
    .eq("id", templateId)
    .maybeSingle()
  const nodes = (data as { snapshot_nodes?: unknown } | null)?.snapshot_nodes
  if (!Array.isArray(nodes)) return false
  const prefix = `/${templateKeptPrefix(templateId)}`
  return nodes.some((n) => {
    const d = n && typeof n === "object" ? (n as { data?: unknown }).data : undefined
    if (!d || typeof d !== "object") return false
    return Object.hasOwn(d, UGC_EXAMPLE_LINES_KEY) || holdsString(d, (s) => s.includes(prefix))
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

/** Detect media type from a URL's extension. Defaults to "image" when unsure. */
function detectMediaTypeFromUrl(url: string): "image" | "video" {
  return /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(url) ? "video" : "image"
}

/**
 * A browse cursor for the count-keyed sorts is `<count>:<created_at>`. Only
 * the FIRST colon separates the two — the ISO timestamp carries its own, and
 * `split(":")` used to hand back `2026-01-15T00` for `…T00:12:34Z`, so the
 * next page compared against midnight and skipped every same-count card
 * created earlier that day.
 */
function parseCompositeCursor(cursor: string): { count: number; date: string } | null {
  const separator = cursor.indexOf(":")
  if (separator === -1) return null
  const count = Number(cursor.slice(0, separator))
  const date = cursor.slice(separator + 1)
  // The date is spliced into a PostgREST `or(...)` expression, so it must be
  // exactly a timestamp — anything else is dropped (first page) rather than
  // handed to the database, which would answer with a 500.
  return Number.isFinite(count) && ISO_TIMESTAMP.test(date) && !Number.isNaN(Date.parse(date)) ? { count, date } : null
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?$/

/** Read listed_in[] from a row defensively (handles legacy rows missing the column). */
function readListedIn(row: Record<string, unknown>): string[] {
  const v = row.listed_in
  return Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : []
}

/**
 * Whether the signed-in viewer is a platform admin. False on an edition with
 * no admin panel (the role is not consulted there), for a signed-out request,
 * and when the role lookup fails: a failed lookup must never widen access.
 */
async function viewerIsAdmin(userId: string | undefined): Promise<boolean> {
  if (!userId || !hasAdmin()) return false
  try {
    return await checkIsAdmin(userId)
  } catch {
    return false
  }
}

/** Toggle a tag in a listed_in array, returning a NEW array (no mutation). */
function withTag(listed: string[], tag: string, present: boolean): string[] {
  const has = listed.includes(tag)
  if (present && !has) return [...listed, tag]
  if (!present && has) return listed.filter((t) => t !== tag)
  return listed
}

// getCreatorDisplayName imported from lib/marketplace-helpers.ts

/** Full camelCase transform for a template row. */
function toCamelCase(row: Record<string, unknown>) {
  const listed = readListedIn(row)
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
    listedIn: listed,
    isListed: listed.includes(MARKETPLACE),
    isTutorial: listed.includes(TUTORIAL),
    tutorialCategoryId: row.tutorial_category_id ?? null,
    tutorialSortOrder: row.tutorial_sort_order ?? 0,
    estimatedCredits: row.estimated_credits,
    // Per minute of the episode (decided 2026-10-07): 0 when the price does not follow a recording's length.
    estimatedPerMinuteCredits: perMinuteOf(row, "estimated_per_minute_credits"),
    // "Up to" (decided 2026-10-14): present only when a choice the template's user has can cost more.
    ...storedTemplateRange(row as Record<string, number | null>),
    // The listed price holds a metered LLM estimate (`≈N`, only while metered pricing is on).
    ...listingEstimateFlag(row),
    category: normalizeTemplateCategory(row.category as string | null | undefined),
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
    estimatedPerMinuteCredits: perMinuteOf(row, "estimated_per_minute_credits"),
    // "Up to" (decided 2026-10-14): present only when a choice the template's user has can cost more.
    ...storedTemplateRange(row as Record<string, number | null>),
    // The listed price holds a metered LLM estimate: the card shows it `≈N` (only while metered pricing is on).
    ...listingEstimateFlag(row),
    category: normalizeTemplateCategory(row.category as string | null | undefined),
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

// publishBodySchema (the "Publish as template" form) lives in
// lib/template-publish-schema.ts, where a first-party template's gallery copy
// is checked against it.

const updateBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  markdownDescription: z.string().max(5000).optional(),
  isActive: z.boolean().optional(),
  isListed: z.boolean().optional(),
  category: z.enum(TEMPLATE_CATEGORIES).optional(),
  outputTypes: z.array(z.enum(VALID_OUTPUT_TYPES)).max(4).optional(),
  tags: z.array(z.string().max(30)).max(10).optional(),
  previewMediaUrl: z.string().url().nullable().optional(),
  previewMediaType: z.enum(["image", "video"]).nullable().optional(),
})

const browseQuerySchema = z.object({
  cursor: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  category: z.enum(TEMPLATE_CATEGORIES).optional(),
  outputType: z.enum(VALID_OUTPUT_TYPES).optional(),
  tag: z.string().max(30).optional(),
  search: z.string().max(100).optional(),
  sort: z.enum(["popular", "newest", "most-favorited", "cheapest"]).optional().default("popular"),
  nodeType: z.string().optional(),
  provider: z.string().optional(),
  complexity: z.enum(VALID_COMPLEXITIES).optional(),
  /** Only the caller's favorited templates — needs a signed-in caller. */
  favoritesOnly: z.enum(["true", "false"]).optional(),
})

const keepCheckBodySchema = z.object({ workflowId: z.string().uuid() })

const cloneBodySchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
})

const tutorialFlagBodySchema = z.object({
  is_tutorial: z.boolean(),
  tutorial_category_id: z.string().uuid().optional(),
  tutorial_sort_order: z.number().int().optional(),
})

const adminListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  search: z.string().max(100).optional(),
  listed: z.enum(["marketplace", "tutorial", "unlisted"]).optional(),
})

// Admin listing toggle for ANY template (not ownership-gated) — remove from the
// marketplace and/or deactivate. At least one field is required.
const adminListingBodySchema = z
  .object({
    isListed: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((b) => b.isListed !== undefined || b.isActive !== undefined, {
    message: "Provide isListed and/or isActive",
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

    const { cursor, limit, category, outputType, tag, search, sort, nodeType, provider, complexity, favoritesOnly } = parsed.data

    // The Favorites view: the caller's own favorites, narrowed by the same
    // filters as any other browse. Private to the caller, so never cached.
    let favoriteIds: string[] | null = null
    if (favoritesOnly === "true") {
      if (!req.userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      const { data: favorites, error: favoritesError } = await supabase
        .from("template_favorites")
        .select("template_id")
        .eq("user_id", req.userId)
      if (favoritesError) return sendInternalError(reply, req, favoritesError, "Failed to browse templates")
      favoriteIds = (favorites ?? []).map((f: { template_id: string }) => f.template_id)
      reply.header("Cache-Control", "private, no-store")
      if (favoriteIds.length === 0) return reply.send({ data: [], nextCursor: null })
    }

    // Card-only columns (no snapshot_nodes/edges/settings)
    const selectCols = "id, slug, name, description, estimated_credits, category, output_types, tags, node_types_used, providers_used, node_count, complexity, preview_media_url, preview_media_type, creator_id, creator_display_name, clone_count, favorite_count, created_at"

    // With the per-minute column, unless it has not reached this database yet
    // (lib/listing-per-minute-columns.ts).
    const buildQuery = (columns: string, perMinute: boolean) => {
      let query = supabase
        .from("workflow_templates")
        .select(columns)
        .contains("listed_in", [MARKETPLACE])
        .eq("is_active", true)
        .limit(limit + 1) // fetch one extra to detect next page

      // Filters
      if (category) query = query.in("category", templateCategoryStoredValues(category))
      if (outputType) query = query.contains("output_types", [outputType])
      if (tag) query = query.contains("tags", [tag])
      if (nodeType) query = query.contains("node_types_used", [nodeType])
      if (provider) query = query.contains("providers_used", [provider])
      if (complexity) query = query.eq("complexity", complexity)
      if (favoriteIds) query = query.in("id", favoriteIds)

      // Full-text search
      if (search) {
        const tsQuery = search.trim().split(/\s+/).join(" & ")
        query = query.textSearch("search_vector", tsQuery)
      }

      // Sort + cursor
      const after = cursor ? parseCompositeCursor(cursor) : null
      if (sort === "popular") {
        query = query.order("clone_count", { ascending: false }).order("created_at", { ascending: false })
        if (after) {
          query = query.or(`clone_count.lt.${after.count},and(clone_count.eq.${after.count},created_at.lt.${after.date})`)
        }
      } else if (sort === "most-favorited") {
        query = query.order("favorite_count", { ascending: false }).order("created_at", { ascending: false })
        if (after) {
          query = query.or(`favorite_count.lt.${after.count},and(favorite_count.eq.${after.count},created_at.lt.${after.date})`)
        }
      } else if (sort === "cheapest") {
        // Fewest credits for a typical episode first (decided 2026-10-07):
        // fixed + TYPICAL_EPISODE_MINUTES x per minute, the generated column of
        // migration 483; before it applies, the fixed price, which then holds
        // the per-minute part folded in at the ceiling. The next page
        // continues PAST the last card — more credits, or the same and older.
        const by = perMinute ? PER_MINUTE_SORT_COLUMN.workflow_templates! : "estimated_credits"
        query = query.order(by, { ascending: true }).order("created_at", { ascending: false })
        if (after) {
          query = query.or(`${by}.gt.${after.count},and(${by}.eq.${after.count},created_at.lt.${after.date})`)
        }
      } else {
        // newest
        query = query.order("created_at", { ascending: false })
        if (cursor) {
          query = query.lt("created_at", cursor)
        }
      }

      return query
    }
    // With the estimate flag (migration 553), unless it has not reached this database yet.
    const { data: rows, error } = await selectWithEstimateFlag<Record<string, unknown>[]>("workflow_templates", selectCols, (flagCols) =>
      selectWithMax<Record<string, unknown>[]>("workflow_templates", flagCols, (columns) =>
        selectWithPerMinute<Record<string, unknown>[]>("workflow_templates", columns, buildQuery, "listed"), "listed"))

    if (error) {
      return sendInternalError(reply, req, error, "Failed to browse templates")
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
      } else if (sort === "cheapest") {
        // The value the sort keyed on: 0 per minute when the column is absent.
        nextCursor = `${typicalEpisodeCredits(Number(last.estimated_credits ?? 0), perMinuteOf(last, LISTED_PER_MINUTE_COLUMN.workflow_templates))}:${last.created_at}`
      } else {
        nextCursor = last.created_at as string
      }
    }

    if (!favoriteIds) reply.header("Cache-Control", "public, max-age=30, stale-while-revalidate=86400")
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
      category, outputTypes, tags, previewMediaUrl, previewMediaType, isListed, includeRunResults,
    } = parsed.data

    // `own`, for the same reason publishing an app takes `own`: a template is
    // a snapshot of this work handed to people outside it. Being allowed to
    // help with a class workflow is not being allowed to publish it, so
    // neither an editor grant nor workspace visibility reaches this.
    const { data: workflow, error: wfError } = await supabase
      // tenant-scope-ignore: authorization follows immediately, below.
      .from("workflows")
      .select("id, user_id, workspace_id, visibility, nodes, edges, settings, thumbnail_url, template_id")
      .eq("id", workflowId)
      .maybeSingle()

    if (wfError || !workflow) {
      return reply.status(404).send({ error: { code: "not_found", message: "Workflow not found" } })
    }
    // 403 for an insufficient level: this route already answered 403 here, and
    // changing a status code is not something a scoping change should do.
    const access = await workflowAccessFromRow(userId, toAccessRow(workflow as unknown as Record<string, unknown>))
    if (!accessAtLeast(access, "own")) {
      return reply.status(403).send({ error: { code: "forbidden", message: "Not your workflow" } })
    }
    // `own` is the LEVEL bar; authorship is a separate one, and both are
    // needed. A platform admin resolves to `own` on every workflow in the
    // database (that is decision 1 of the access rule, and it is deliberate),
    // which would let one publish a stranger's private work under their own
    // creator id. Publishing is the one act where being able to reach the
    // work is not the question — having made it is.
    if (workflow.user_id !== userId) {
      return reply.status(403).send({ error: { code: "forbidden", message: "Not your workflow" } })
    }

    // A template snapshot keeps the canvas's results: their saved ids are
    // resolved first (canvas-result-ids.ts), as every read hands them.
    const nodes = (await resolveCanvasResultIds(workflow.nodes || [], workflow.user_id, { settings: workflow.settings })) as Array<Record<string, unknown>>
    const edges = (workflow.edges || []) as Array<Record<string, unknown>>
    // What is published is run by its USERS, so it must be runnable by them —
    // asked as the users' view even when the publisher is an admin who can run
    // the node themselves (lib/surface-deny.ts :: findUnpublishableNodeTypes).
    const unpublishable = findUnpublishableNodeTypes(nodes)
    if (unpublishable.length > 0) {
      return reply.status(400).send({
        error: { code: "node_not_available", message: unpublishableNodesMessage(unpublishable) },
      })
    }

    // Auto-derive metadata
    const nodeTypesUsed = extractNodeTypes(nodes)
    const providersUsed = extractProviders(nodes)
    const nodeCount = nodes.length
    const complexity = calculateComplexity(nodes, edges)
    // The listed price is an app's (decided 2026-10-06): the whole graph at
    // Preview plus each Render final, preview stop rule or not. A template has
    // no creator fee. An exposed speech text is priced at its input's character
    // limit, or the model's cap — never the author's placeholder
    // (lib/exposed-text-caps.ts).
    //
    // Whoever clones this template gets the snapshot (ugc-composed-graph.ts, the one funnel): a UGC
    // video's run state (a kept creator, the last plan, clip tickets, takes, cards and Notes),
    // everything made from the video — a sub-workflow whose graph holds one among them — and every
    // value that can flow into a UGC Creator's photo input, read with the sub-workflows the graph
    // references, never ship: the cloner's UGC nodes, and the nodes made from them, start empty.
    // The listing is priced on this snapshot, what its cloners run: with Keep off, a UGC video's
    // script and creator are priced, at the length its cloners get.
    // A referenced graph that fails to read refuses the publish, retryably, before anything is written.
    //
    // A template whose author opted in (`includeRunResults`, design: UGC templates with data) also
    // ships ONE proven AI-creator run's display values, copied to the template's own storage
    // (`ugcPublishedGraph`'s `keepRunResults`; a video made from the author's photo, or one the
    // author's own jobs do not prove, keeps nothing). The listing is priced WITHOUT them
    // (`pricedNodes`): a cloner's run makes everything again, so the choice never changes the price.
    // A copy that fails refuses the publish, writing nothing.
    // Check if template already exists for this workflow + creator
    const { data: existingTemplate } = await supabase
      .from("workflow_templates")
      .select("id, slug, name, listed_in")
      .eq("workflow_id", workflowId)
      .eq("creator_id", userId)
      .eq("is_active", true)
      .maybeSingle()
    // Pre-generate a new template's ID so the durable copies (the preview, a kept run) can land at
    // stamped R2 keys (templates/<id>/…) BEFORE the row exists. The retry loop below only varies the
    // slug — the UUID is fixed.
    const templateId = (existingTemplate?.id as string | undefined) ?? randomUUID()
    // Only a workflow holding a UGC video of its own can keep a run (a sub-workflow's or a component's
    // never does); any other publish reads and writes exactly what it did before.
    const holdsUgcVideo = nodes.some((n) => typeof n.type === "string" && UGC_NODE_TYPES.has(n.type))
    const keepRun = holdsUgcVideo && (includeRunResults ?? (existingTemplate ? await snapshotKeepsRun(existingTemplate.id as string) : false))
    // Priced BEFORE anything is copied (R49/R51): the listing reads the graph WITHOUT the kept run
    // (`pricedNodes`), so a pass that copies nothing prices exactly what the keeping pass would, and a
    // publish refused for a metered LLM model with no price has written and billed no storage. Only a
    // publish that keeps a run makes the second, copying pass.
    type PublishEdges = Array<{ source?: string; target?: string; sourceHandle?: string | null; targetHandle?: string | null }>
    const funnelOptions = { failOnError: true, settings: workflow.settings as Record<string, unknown> | null }
    let published: UgcPublishedGraph<(typeof nodes)[number]>
    try {
      published = await ugcPublishedGraph(nodes, edges as PublishEdges, workflow.user_id, funnelOptions)
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to publish template")
    }
    const pricedNodes = published.pricedNodes
    const speechTextCaps = exposedTextCaps(workflow.settings as Record<string, unknown> | null, pricedNodes as unknown as EstimateNode[])
    // A range (decided 2026-10-14): "from" the saved settings, "up to" the most a
    // run can cost over the template's exposed fields.
    let listing: Awaited<ReturnType<typeof estimateWorkflowListingCredits>>
    try {
      listing = await estimateWorkflowListingCredits(pricedNodes as unknown as EstimateNode[], edges as unknown as EstimateEdge[], {
        publishType: "template",
        speechTextCaps,
        // A template's cloner replaces every upload node, whatever this says: its
        // sample recording's length is not theirs (decided 2026-10-07).
        replaceableMediaNodeIds: exposedMediaNodeIds(null, pricedNodes as unknown as EstimateNode[]),
        snapshotSettings: published.settings as Record<string, unknown> | null,
        // Shown to everyone: a general user's run — several recordings only while Speaker Map is every
        // user's, an `auto` framing source as the even split while Speaker Frames is not (decided 2026-10-20).
        ...usecaseViewerForEveryone(pricedNodes as unknown as EstimateNode[]),
      })
    } catch (err) {
      // A metered LLM model with no price (R49): nothing is listed at a price its run would refuse.
      if (await replyIfLlmUnpriced(reply, err)) return reply
      throw err
    }
    if (keepRun) {
      try {
        published = await ugcPublishedGraph(nodes, edges as PublishEdges, workflow.user_id, {
          ...funnelOptions,
          keepRunResults: { copy: (address: string) => copyToTemplateKept(address, templateId, userId) },
        })
      } catch (err) {
        return sendInternalError(reply, req, err, "Failed to publish template")
      }
    }
    const snapshotNodes = published.nodes
    const keptResults = published.kept ?? { included: false, reason: includeRunResults && !holdsUgcVideo ? ("no_ugc_video" as const) : ("not_requested" as const) }
    const estimatedCredits = listing.preview + listing.final
    // Per minute of the episode (decided 2026-10-07): 0 when the price does not follow a recording's length.
    const estimatedPerMinuteCredits = listing.previewPerMinute + listing.finalPerMinute
    // No ceiling computed (none to compute): "up to" is the "from".
    const ceiling = listing.ceiling ?? listing
    const maxColumns = {
      max_estimated_credits: ceiling.preview + ceiling.final,
      max_estimated_per_minute_credits: ceiling.previewPerMinute + ceiling.finalPerMinute,
    }

    // Resolve the source URL for the template preview with priority:
    //   1. explicit previewMediaUrl from request body
    //   2. workflows.thumbnail_url — what the user clicked "Set as Thumbnail" on
    //   3. derivePreviewMedia(snapshotNodes) — first node with a result in what is
    //      published, fallback only: never a render the snapshot strips
    // This is just the SOURCE; the actual preview_media_url written to the
    // template row is a durable COPY at templates/<id>/preview-<stamp>.<ext> below.
    // A preview the author chose (1 or 2) ships as they chose it, their photo or
    // something made from it included; only the fallback (3) is read from what
    // ships, so it is never anything publishing empties.
    const sentPreview = previewMediaUrl ?? null
    let sourcePreviewUrl: string | null = sentPreview
    let sourcePreviewType: "image" | "video" | null = sentPreview ? previewMediaType ?? null : null
    if (!sourcePreviewUrl) {
      const workflowThumb = (workflow.thumbnail_url ?? null) as string | null
      // A workflow cloned before clones started with no thumbnail still holds the source
      // template's preview: that is no pick of this author's, and goes the automatic way.
      if (workflowThumb && !(await inheritedFromTemplate(workflow.template_id, workflowThumb))) {
        sourcePreviewUrl = workflowThumb
        sourcePreviewType = detectMediaTypeFromUrl(workflowThumb)
      }
    }
    // A kept run's own output (its captioned video) comes before the automatic pick: never the
    // creator's face or an upload.
    if (!sourcePreviewUrl && keptResults.included && keptResults.previewUrl) {
      sourcePreviewUrl = keptResults.previewUrl
      sourcePreviewType = detectMediaTypeFromUrl(keptResults.previewUrl)
    }
    if (!sourcePreviewUrl) {
      const derived = derivePreviewMedia(pricedNodes)
      if (derived) {
        sourcePreviewUrl = derived.url
        sourcePreviewType = derived.type
      }
    }

    // Get creator display name
    const creatorDisplayName = await getCreatorDisplayName(userId)


    if (existingTemplate) {
      const existingListed = readListedIn(existingTemplate as Record<string, unknown>)
      // Preserve admin-set 'tutorial' tag across creator re-publishes; only
      // touch the 'marketplace' tag if the creator explicitly sent isListed.
      const nextListed =
        isListed === undefined
          ? existingListed
          : withTag(existingListed, MARKETPLACE, isListed)

      const updates: Record<string, unknown> = {
        name,
        description: description || null,
        markdown_description: markdownDescription || null,
        snapshot_nodes: snapshotNodes,
        snapshot_edges: edges,
        snapshot_settings: published.settings || {},
        node_types_used: nodeTypesUsed,
        providers_used: providersUsed,
        node_count: nodeCount,
        complexity,
        estimated_credits: estimatedCredits,
        // The listed price holds a metered LLM estimate (shown `≈N`, Task 12 / R47).
        ...estimateFlagColumn(listing),
        estimated_per_minute_credits: estimatedPerMinuteCredits,
        ...maxColumns,
        category: category ?? DEFAULT_TEMPLATE_CATEGORY,
        output_types: outputTypes ?? [],
        tags: tags ?? [],
        // preview_media_url / preview_media_type are set below conditionally:
        // if we cannot resolve a source URL (asset deleted, no node result),
        // KEEP the existing values rather than wiping them to null. Re-publish
        // after deleting the source asset used to silently blank the preview.
        creator_display_name: creatorDisplayName,
        listed_in: nextListed,
      }

      // Refresh the preview only if we have a fresh source URL. A copy
      // failure logs and continues — losing one refresh is better than
      // failing the whole publish over an R2 hiccup.
      if (sourcePreviewUrl && sourcePreviewType) {
        try {
          const durableUrl = await copyToTemplatePreview(
            sourcePreviewUrl,
            existingTemplate.id,
            sourcePreviewType,
            userId,
          )
          updates.preview_media_url = durableUrl
          updates.preview_media_type = sourcePreviewType
        } catch (err) {
          console.error("[templates/publish] preview copy failed (UPDATE):", err)
        }
      }

      // The slug is never rewritten here — not on a rename, not when the request carries a
      // different `slug`: a published template's link stays stable. (`slug` only matters to a NEW
      // template; see templateSlugCandidate.)

      // The estimate flag drops out until migration 553 reaches this database.
      const { data: updated, error: updateError } = await writeWithEstimateFlag("workflow_templates", updates, (flagged) =>
        writeWithMax("workflow_templates", flagged, (withMax) =>
          writeWithPerMinute("workflow_templates", withMax, (row) =>
            supabase.from("workflow_templates").update(row).eq("id", existingTemplate.id).select().single(),
          ),
        ),
      )

      if (updateError || !updated) {
        return sendInternalError(reply, req, updateError, "Failed to update template")
      }

      return reply.send({ ...toCamelCase(updated as Record<string, unknown>), keptResults: publicKept(keptResults) })
    }

    const newTemplateId = templateId

    let durablePreviewUrl: string | null = null
    let durablePreviewType: "image" | "video" | null = null
    if (sourcePreviewUrl && sourcePreviewType) {
      try {
        durablePreviewUrl = await copyToTemplatePreview(
          sourcePreviewUrl,
          newTemplateId,
          sourcePreviewType,
          userId,
        )
        durablePreviewType = sourcePreviewType
      } catch (err) {
        console.error("[templates/publish] preview copy failed (INSERT):", err)
      }
    }

    // INSERT new template with slug collision retry
    const MAX_SLUG_RETRIES = 5
    let publishedTemplate: Record<string, unknown> | null = null
    let insertError: { code?: string; message?: string } | null = null
    const initialListed = isListed ? [MARKETPLACE] : []

    for (let attempt = 0; attempt < MAX_SLUG_RETRIES; attempt++) {
      // A requested slug is used as asked when it is free; a taken one (or a lost race: the same
      // unique violation) falls back to its suffixed form on the next pass.
      const slug = templateSlugCandidate(providedSlug, name, attempt)

      const result = await writeWithEstimateFlag("workflow_templates", {
          id: newTemplateId,
          workflow_id: workflowId,
          creator_id: userId,
          name,
          description: description || null,
          markdown_description: markdownDescription || null,
          slug,
          snapshot_nodes: snapshotNodes,
          snapshot_edges: edges,
          snapshot_settings: published.settings || {},
          node_types_used: nodeTypesUsed,
          providers_used: providersUsed,
          node_count: nodeCount,
          complexity,
          estimated_credits: estimatedCredits,
          // The listed price holds a metered LLM estimate (shown `≈N`, Task 12 / R47).
          ...estimateFlagColumn(listing),
          estimated_per_minute_credits: estimatedPerMinuteCredits,
          ...maxColumns,
          category: category ?? DEFAULT_TEMPLATE_CATEGORY,
          output_types: outputTypes ?? [],
          tags: tags ?? [],
          preview_media_url: durablePreviewUrl,
          preview_media_type: durablePreviewType,
          listed_in: initialListed,
          creator_display_name: creatorDisplayName,
        }, (flagged) => writeWithMax("workflow_templates", flagged, (withMax) => writeWithPerMinute("workflow_templates", withMax, (row) => supabase.from("workflow_templates").insert(row).select().single())))

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
      return sendInternalError(reply, req, insertError, "Failed to publish template")
    }

    return reply.send({ ...toCamelCase(publishedTemplate), keptResults: publicKept(keptResults) })
  })

  // =========================================================================
  // 2b. POST /v1/templates/keep-check — Can this workflow's run ship as an example?
  // =========================================================================
  // The publish dialog's dry run of "Include this run's results": the same funnel publishing runs
  // (layer 1 on the graph, the author's own jobs as proof), copying and writing nothing. `shown` is
  // false for a workflow with no UGC video (the dialog shows no choice); `reason` says why a video
  // cannot keep its run. The publish itself decides again.
  app.post("/v1/templates/keep-check", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    const parsed = keepCheckBodySchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data: workflow, error: wfError } = await supabase
      // tenant-scope-ignore: authorization follows immediately, below (as publish).
      .from("workflows")
      .select("id, user_id, workspace_id, visibility, nodes, edges, settings")
      .eq("id", parsed.data.workflowId)
      .maybeSingle()
    if (wfError || !workflow) return reply.status(404).send({ error: { code: "not_found", message: "Workflow not found" } })
    const access = await workflowAccessFromRow(userId, toAccessRow(workflow as unknown as Record<string, unknown>))
    if (!accessAtLeast(access, "own") || workflow.user_id !== userId) {
      return reply.status(403).send({ error: { code: "forbidden", message: "Not your workflow" } })
    }
    const nodes = (await resolveCanvasResultIds(workflow.nodes || [], workflow.user_id, { settings: workflow.settings })) as Array<Record<string, unknown>>
    const edges = (workflow.edges || []) as Array<{ source?: string; target?: string; sourceHandle?: string | null; targetHandle?: string | null }>
    let kept: UgcKeptResults | undefined
    try {
      kept = (await ugcPublishedGraph(nodes, edges, workflow.user_id, { failOnError: true, keepRunResults: {} })).kept
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to check the run")
    }
    const answer = kept ?? { included: false, reason: "no_ugc_video" as const }
    const shown = answer.reason !== "no_ugc_video"
    // The author's last choice, for the dialog to start from: whether the template already published
    // from this workflow ships a kept run.
    let current = false
    if (shown) {
      const { data: existing } = await supabase
        .from("workflow_templates")
        .select("id")
        .eq("workflow_id", parsed.data.workflowId)
        .eq("creator_id", userId)
        .eq("is_active", true)
        .maybeSingle()
      if (typeof (existing as { id?: unknown } | null)?.id === "string") current = await snapshotKeepsRun((existing as { id: string }).id)
    }
    return reply.send({
      shown,
      eligible: answer.included,
      current,
      ...(answer.reason ? { reason: answer.reason } : {}),
    })
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
      return sendInternalError(reply, req, error, "Failed to fetch templates")
    }

    return reply.send((templates || []).map((t: unknown) => toCamelCase(t as Record<string, unknown>)))
  })

  // =========================================================================
  // 4. GET /v1/templates/:slug — Public single template with full snapshot
  // =========================================================================
  app.get("/v1/templates/:slug", async (req, reply) => {
    const { slug } = req.params as { slug: string }

    // No `is_active` filter in the query: the slug is UNIQUE across every row
    // (migration 076), and an admin may preview a template that is off.
    const { data: template, error } = await supabase
      .from("workflow_templates")
      .select("*")
      .eq("slug", slug)
      .maybeSingle()

    if (error) {
      return sendInternalError(reply, req, error, "Failed to fetch template")
    }
    if (!template) {
      return reply.status(404).send({ error: { code: "not_found", message: "Template not found" } })
    }

    // Broken-object-level-auth guard: this route is public and uses the
    // service-role client (RLS bypassed), so `is_active` alone would expose
    // templates the creator never listed. Only return a template that is on
    // AND listed in a public channel, OR is being fetched by its own creator.
    // An admin reads any template — listed or not, on or off — to preview it
    // from Admin → Templates; the role is asked only when nothing else lets
    // the request through.
    const row = template as Record<string, unknown>
    const listed = readListedIn(row)
    const isListedPublicly = listed.includes(MARKETPLACE) || listed.includes(TUTORIAL)
    const isOwner = !!req.userId && req.userId === row.creator_id
    const visible = row.is_active === true && (isListedPublicly || isOwner)
    if (!visible && !(await viewerIsAdmin(req.userId))) {
      return reply.status(404).send({ error: { code: "not_found", message: "Template not found" } })
    }

    return reply.send(toCamelCase(row))
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
      return sendInternalError(reply, req, error, "Failed to favorite template")
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
      return sendInternalError(reply, req, error, "Failed to fetch favorites")
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

    // Baked demo outputs are preserved on purpose: a tutorial clone must open
    // showing the real run it teaches, not empty grey boxes (spec B5 §5.5).
    // Do NOT reintroduce a strip step here — the clone-preserves-baked-results
    // guard test in workflow-templates.test.ts pins this.
    const snapshotNodes = (template.snapshot_nodes || []) as Array<Record<string, unknown>>

    // Create new workflow in target project. It starts with no thumbnail: the
    // template's preview is its author's pick, never the cloner's, and a template
    // published from the clone reads its preview from what ships unless the
    // cloner sets one (Set as Thumbnail).
    const workflowName = customName || template.name
    const { data: newWorkflow, error: wfError } = await supabase
      .from("workflows")
      .insert({
        project_id: projectId,
        user_id: userId,
        name: workflowName,
        nodes: snapshotNodes,
        edges: template.snapshot_edges || [],
        settings: template.snapshot_settings || {},
        template_id: template.id,
        thumbnail_url: null,
      })
      .select("id")
      .single()

    if (wfError || !newWorkflow) {
      return sendInternalError(reply, req, wfError, "Failed to clone template")
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
      .select("id, creator_id, listed_in")
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
    if (body.isListed !== undefined) {
      const existingListed = readListedIn(existing as Record<string, unknown>)
      updates.listed_in = withTag(existingListed, MARKETPLACE, body.isListed)
    }
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
      return sendInternalError(reply, req, updateError, "Failed to update template")
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
      return sendInternalError(reply, req, updateError, "Failed to deactivate template")
    }

    return reply.send({ success: true })
  })

  // =========================================================================
  // 10. GET /v1/admin/workflow-templates — Admin list ALL templates
  //
  // Admin routes 10 + 11 are gated by hasAdmin() so they never register in
  // community builds where the `requireAdmin` preHandler would crash on the
  // missing role table. Static import of requireAdmin is allowlisted in
  // tools/check-ee-imports.mjs (Phase 3.5 — this whole file will move to a
  // dynamic-require shim alongside the credit imports).
  // =========================================================================
  if (hasAdmin()) {
  app.get("/v1/admin/workflow-templates", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = adminListQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }
    const { cursor, limit, search, listed } = parsed.data

    const selectCols = "id, slug, name, description, listed_in, tutorial_category_id, tutorial_sort_order, is_active, category, node_count, complexity, preview_media_url, preview_media_type, creator_id, creator_display_name, clone_count, favorite_count, created_at"

    let query = supabase
      .from("workflow_templates")
      .select(selectCols)
      .order("created_at", { ascending: false })
      .limit(limit + 1)

    if (cursor) query = query.lt("created_at", cursor)
    if (search) {
      const tsQuery = search.trim().split(/\s+/).join(" & ")
      query = query.textSearch("search_vector", tsQuery)
    }
    if (listed === "marketplace") query = query.contains("listed_in", [MARKETPLACE])
    else if (listed === "tutorial") query = query.contains("listed_in", [TUTORIAL])
    else if (listed === "unlisted") query = query.eq("listed_in", [])

    const { data: rows, error } = await query
    if (error) {
      return sendInternalError(reply, req, error, "Failed to list templates")
    }

    const items = (rows ?? []).slice(0, limit)
    const hasMore = (rows ?? []).length > limit
    const nextCursor =
      hasMore && items.length > 0
        ? ((items[items.length - 1] as Record<string, unknown>).created_at as string)
        : null

    return reply.send({
      data: items.map((r: unknown) => toCamelCase(r as Record<string, unknown>)),
      nextCursor,
    })
  })

  // =========================================================================
  // 11. PATCH /v1/admin/workflow-templates/:id/tutorial-flag — Toggle tutorial
  // =========================================================================
  app.patch(
    "/v1/admin/workflow-templates/:id/tutorial-flag",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const paramResult = z.object({ id: z.string().uuid() }).safeParse(req.params)
      if (!paramResult.success) {
        return reply.status(400).send({ error: { code: "validation_error", message: "Invalid template ID" } })
      }
      const bodyResult = tutorialFlagBodySchema.safeParse(req.body)
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: { code: "validation_error", message: bodyResult.error.issues[0]?.message ?? "Invalid body" },
        })
      }

      const { id } = paramResult.data
      const { is_tutorial, tutorial_category_id, tutorial_sort_order } = bodyResult.data

      if (is_tutorial && !tutorial_category_id) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: "tutorial_category_id is required when is_tutorial=true",
          },
        })
      }

      const { data: existing, error: fetchError } = await supabase
        .from("workflow_templates")
        .select("id, listed_in, tutorial_category_id, tutorial_sort_order")
        .eq("id", id)
        .maybeSingle()

      if (fetchError) {
        return sendInternalError(reply, req, fetchError, "Failed to update tutorial flag")
      }
      if (!existing) {
        return reply.status(404).send({ error: { code: "not_found", message: "Template not found" } })
      }

      const currentListed = readListedIn(existing as Record<string, unknown>)
      const nextListed = withTag(currentListed, TUTORIAL, is_tutorial)

      const updates: Record<string, unknown> = { listed_in: nextListed }
      if (is_tutorial) {
        updates.tutorial_category_id = tutorial_category_id
        if (tutorial_sort_order !== undefined) updates.tutorial_sort_order = tutorial_sort_order
      }

      const { data: updated, error: updateError } = await supabase
        .from("workflow_templates")
        .update(updates)
        .eq("id", id)
        .select()
        .single()

      if (updateError) {
        if (updateError.code === "23503") {
          return reply.status(400).send({
            error: { code: "invalid_category", message: "tutorial_category_id does not reference a known category" },
          })
        }
        return sendInternalError(reply, req, updateError, "Failed to update tutorial flag")
      }

      return reply.send(toCamelCase(updated as Record<string, unknown>))
    },
  )

  // =========================================================================
  // 12. PATCH /v1/admin/workflow-templates/:id/listing — Admin unlist/hide ANY
  //     template. Unlike the owner PATCH (/v1/templates/:id), this is NOT
  //     ownership-gated: an admin can remove any template from the marketplace
  //     (isListed:false) or deactivate it (isActive:false) — e.g. to hide a
  //     first-party template that was published without a cover.
  // =========================================================================
  app.patch(
    "/v1/admin/workflow-templates/:id/listing",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const paramResult = z.object({ id: z.string().uuid() }).safeParse(req.params)
      if (!paramResult.success) {
        return reply.status(400).send({ error: { code: "validation_error", message: "Invalid template ID" } })
      }
      const bodyResult = adminListingBodySchema.safeParse(req.body)
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: { code: "validation_error", message: bodyResult.error.issues[0]?.message ?? "Invalid body" },
        })
      }

      const { id } = paramResult.data
      const { isListed, isActive } = bodyResult.data

      const { data: existing, error: fetchError } = await supabase
        .from("workflow_templates")
        .select("id, listed_in")
        .eq("id", id)
        .maybeSingle()

      if (fetchError) {
        return sendInternalError(reply, req, fetchError, "Failed to update template listing")
      }
      if (!existing) {
        return reply.status(404).send({ error: { code: "not_found", message: "Template not found" } })
      }

      const updates: Record<string, unknown> = {}
      if (isListed !== undefined) {
        updates.listed_in = withTag(readListedIn(existing as Record<string, unknown>), MARKETPLACE, isListed)
      }
      if (isActive !== undefined) updates.is_active = isActive

      const { data: updated, error: updateError } = await supabase
        .from("workflow_templates")
        .update(updates)
        .eq("id", id)
        .select()
        .single()

      if (updateError) {
        return sendInternalError(reply, req, updateError, "Failed to update template listing")
      }

      return reply.send(toCamelCase(updated as Record<string, unknown>))
    },
  )
  } // end if (hasAdmin())
}
