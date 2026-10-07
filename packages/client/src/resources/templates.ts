import type { NodaroClient } from "../client.js"

/**
 * Workflow-template marketplace — the PUBLIC-BY-DESIGN surfaces only:
 * browse cards, a single template with its full snapshot, and the free
 * clone-into-my-project action. Creator/admin surfaces (publish, mine,
 * favorites, metadata patch, tutorial flags) are deliberately NOT part of
 * the public SDK contract; first-party apps reach them via
 * `client.request()`.
 */

/** Card returned by the marketplace browse (no snapshot payload). */
export interface TemplateBrowseCard {
  id: string
  slug: string
  name: string
  description: string | null
  /** The listed price; when `estimatedPerMinuteCredits` is above 0, its fixed part. */
  estimatedCredits: number
  /**
   * Credits per minute of the recording the template is given, when its price
   * follows that recording's length (an Apply EDL render of a whole episode,
   * an Edit Plan pass): the price is `estimatedCredits` plus this per minute.
   * 0 or absent when the price does not depend on a recording's length.
   */
  estimatedPerMinuteCredits?: number
  category: string
  outputTypes: string[]
  tags: string[]
  nodeTypesUsed: string[]
  providersUsed: string[]
  nodeCount: number
  complexity: string
  previewMediaUrl: string | null
  previewMediaType: "image" | "video" | null
  creatorId: string
  creatorDisplayName: string | null
  cloneCount: number
  favoriteCount: number
  createdAt: string
}

export type TemplateSort = "newest" | "popular" | "most-favorited"

export interface BrowseTemplatesParams {
  /** Opaque cursor from the previous page's `nextCursor`. */
  cursor?: string
  limit?: number
  category?: string
  outputType?: string
  tag?: string
  /** Full-text search over name/description/tags. */
  search?: string
  sort?: TemplateSort
  /** Only templates using this node type. */
  nodeType?: string
  /** Only templates using this provider/model id. */
  provider?: string
  complexity?: string
}

export interface BrowseTemplatesResult {
  data: TemplateBrowseCard[]
  /** Pass back as `cursor` to fetch the next page; `null` on the last page. */
  nextCursor: string | null
}

/**
 * A single public template (`GET /v1/templates/:slug`) — the browse-card
 * fields plus the full workflow snapshot the viewer/clone consume. The route
 * returns the whole camelCased row, so additional columns may appear beyond
 * the ones typed here; the index signature keeps them reachable without
 * casting.
 */
export interface Template extends TemplateBrowseCard {
  markdownDescription: string | null
  /** React Flow node snapshots (generic node JSON, execution data stripped on clone). */
  snapshotNodes: unknown[]
  snapshotEdges: unknown[]
  snapshotSettings: Record<string, unknown>
  /** Channels the template is listed in (e.g. "marketplace", "tutorial"). */
  listedIn: string[]
  readonly [key: string]: unknown
}

export interface CloneTemplateParams {
  /** Target project (must belong to the caller). */
  projectId: string
  /** Optional name for the cloned workflow; defaults to the template's name. */
  name?: string
}

export interface CloneTemplateResult {
  workflowId: string
  projectId: string
}

export class TemplatesResource {
  constructor(private client: NodaroClient) {}

  /** Browse the public template marketplace (cursor-paginated, no auth required). */
  browse(params: BrowseTemplatesParams = {}): Promise<BrowseTemplatesResult> {
    return this.client.request("GET", "/v1/templates/browse", { query: { ...params } })
  }

  /** Fetch one public template by slug, including its full workflow snapshot. */
  get(slug: string): Promise<Template> {
    return this.client.request("GET", `/v1/templates/${encodeURIComponent(slug)}`)
  }

  /** Clone a template into one of the caller's projects. Free — no credits charged. */
  clone(slug: string, params: CloneTemplateParams): Promise<CloneTemplateResult> {
    return this.client.request("POST", `/v1/templates/${encodeURIComponent(slug)}/clone`, {
      body: params,
    })
  }
}
