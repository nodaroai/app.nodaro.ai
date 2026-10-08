import type { NodaroClient } from "../client.js"

/**
 * Public tutorials directory (`GET /v1/tutorials`) — video tutorials and
 * flow (template) tutorials, pre-grouped under the shared category taxonomy.
 * Read-only by design; curation is an admin surface outside the public SDK.
 */

export interface TutorialVideoItem {
  id: string
  type: "video"
  title: string
  description: string | null
  videoUrl: string
  thumbnailUrl: string | null
  categoryId: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/** A workflow template surfaced as a tutorial; `slug` feeds `client.templates`. */
export interface TutorialFlowItem {
  id: string
  type: "flow"
  templateId: string
  slug: string | null
  title: string
  description: string | null
  markdownDescription: string | null
  previewMediaUrl: string | null
  previewMediaType: "image" | "video" | null
  complexity: string
  /** The listed price; when `estimatedPerMinuteCredits` is above 0, its fixed part. */
  estimatedCredits: number
  /** Credits per minute of the recording the template is given (see `TemplateBrowseCard`); 0 or absent when none. */
  estimatedPerMinuteCredits?: number
  nodeTypesUsed: string[]
  providersUsed: string[]
  nodeCount: number
  categoryId: string
  tutorialSortOrder: number
  workflowId: string
  createdAt: string
}

export interface TutorialCategory {
  id: string
  name: string
  slug: string
  sortOrder: number
  videos: TutorialVideoItem[]
  flows: TutorialFlowItem[]
}

export class TutorialsResource {
  constructor(private client: NodaroClient) {}

  /** All enabled tutorial categories with their videos and flow tutorials. Public. */
  list(): Promise<{ categories: TutorialCategory[] }> {
    return this.client.request("GET", "/v1/tutorials")
  }
}
