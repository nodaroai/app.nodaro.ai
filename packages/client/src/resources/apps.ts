import type { NodaroClient } from "../client.js"

/**
 * A published app — a workflow wrapped in a curated input/output presentation.
 * Returned by the public `/v1/apps/browse` endpoint.
 */
export interface PublishedApp {
  id: string
  slug: string
  name: string
  description?: string | null
  creatorId: string
  creatorName?: string | null
  thumbnailUrl?: string | null
  category?: string | null
  isFeatured?: boolean
  runCount?: number
  createdAt: string
  updatedAt: string
}

export interface ListAppsParams {
  /** Substring search across app name + description. */
  search?: string
  /** Page size; backend caps at 50. */
  limit?: number
  /** Cursor token returned by the previous page. */
  cursor?: string
  /** Filter to a single category slug. */
  category?: string
}

export interface ListAppsResult {
  data: PublishedApp[]
  nextCursor?: string | null
}

/**
 * App detail — includes the input schema (required + optional fields end users
 * fill in) and the output mapping (which workflow nodes produce which display
 * cards).
 */
export interface PublishedAppDetail extends PublishedApp {
  inputSchema: Record<string, unknown>
  outputs: Array<{ nodeId: string; label: string; type: string }>
}

export interface AppRunResult {
  /** The execution-id that was started — poll via client.executions.get(). */
  executionId: string
  status: "pending" | "running"
  /** App-run id (distinct from executionId — used by listRuns/getRun). */
  runId?: string
}

export interface AppRun {
  id: string
  appSlug: string
  executionId: string
  status: "pending" | "running" | "completed" | "failed" | "cancelled"
  inputs: Record<string, unknown>
  outputs?: Array<{ nodeId: string; type: string; url?: string; text?: string }>
  startedAt: string
  finishedAt?: string | null
}

export interface ListAppRunsParams {
  limit?: number
  cursor?: string
}

/**
 * Result of a soft-delete (archive) operation. The run is moved to the user's
 * archive in the Nodaro UI; restoration and permanent deletion are UI-only by
 * design — SDK / MCP / API delete callers can't accidentally destroy data.
 */
export interface DeleteAppRunResult {
  success: true
  archived: true
}

export class AppsResource {
  constructor(private client: NodaroClient) {}

  /** List published apps. Public — no auth required for community apps. */
  list(params: ListAppsParams = {}): Promise<ListAppsResult> {
    const qs = new URLSearchParams()
    if (params.search) qs.set("search", params.search)
    if (params.limit !== undefined) qs.set("limit", String(params.limit))
    if (params.cursor) qs.set("cursor", params.cursor)
    if (params.category) qs.set("category", params.category)
    const query = qs.toString()
    return this.client.request("GET", `/v1/apps/browse${query ? `?${query}` : ""}`)
  }

  /** Get one app's metadata + input schema by slug. */
  get(slug: string): Promise<{ data: PublishedAppDetail }> {
    return this.client.request("GET", `/v1/app/${encodeURIComponent(slug)}`)
  }

  /**
   * Trigger an app run with the given input values. The keys in `inputs` must
   * match the app's input-schema field names (see `get(slug).inputSchema`).
   * Returns the execution-id for status polling via client.executions.get().
   */
  run(slug: string, inputs: Record<string, unknown> = {}): Promise<AppRunResult> {
    return this.client.request("POST", `/v1/app/${encodeURIComponent(slug)}/run`, {
      body: { inputs },
    })
  }

  /** List past runs for an app (the caller must own the app or the runs). */
  listRuns(slug: string, params: ListAppRunsParams = {}): Promise<{ data: AppRun[]; nextCursor?: string | null }> {
    const qs = new URLSearchParams()
    if (params.limit !== undefined) qs.set("limit", String(params.limit))
    if (params.cursor) qs.set("cursor", params.cursor)
    const query = qs.toString()
    return this.client.request(
      "GET",
      `/v1/app/${encodeURIComponent(slug)}/runs${query ? `?${query}` : ""}`,
    )
  }

  /** Get one app-run by id. */
  getRun(slug: string, runId: string): Promise<{ data: AppRun }> {
    return this.client.request(
      "GET",
      `/v1/app/${encodeURIComponent(slug)}/runs/${encodeURIComponent(runId)}`,
    )
  }

  /**
   * Archive (soft-delete) a published-app run. The run is hidden from the
   * default run list and can be restored or permanently deleted from the
   * archive view at https://app.nodaro.ai/archived-runs.
   *
   * @param slug   The published app's slug (the last path segment of its URL).
   * @param runId  The run's UUID.
   */
  deleteRun(slug: string, runId: string): Promise<DeleteAppRunResult> {
    return this.client.request(
      "DELETE",
      `/v1/app/${encodeURIComponent(slug)}/runs/${encodeURIComponent(runId)}`,
    )
  }
}
